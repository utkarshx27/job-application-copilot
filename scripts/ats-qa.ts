import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { chromium, type BrowserContext, type Page } from "@playwright/test";
import {
  AtsQaFixtureSchema,
  AtsQaReviewSchema,
  QaAdapterSchema,
  adapterVersionFor,
  aggregateQaResults,
  createReviewTemplate,
  createSanitizedQaFixture,
  evaluateQaFixture,
  manualReviewBatchId,
  pathPattern,
  qaFixtureIdForUrl,
  qaReportMarkdown,
  sanitizeMetadata,
  validatePublicCaptureUrl,
  type AtsQaFixture,
  type AtsQaReview,
  type QaAdapter,
  type QaReviewQueueItem,
} from "@copilot/ats-qa";
import { PageSnapshotSchema, type PageSnapshot } from "@copilot/form-schema";
import { z } from "zod";

const UrlEntrySchema = z.union([
  z.url(),
  z.object({ url: z.url(), adapter: QaAdapterSchema.optional() }),
]);
const UrlListSchema = z.array(UrlEntrySchema).min(1).max(250);
type UrlEntry = z.infer<typeof UrlEntrySchema>;

type CliOptions = Record<string, string | boolean>;

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument?.startsWith("--")) throw new Error(`Unexpected argument: ${argument ?? ""}`);
    const name = argument.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) options[name] = true;
    else {
      options[name] = next;
      index += 1;
    }
  }
  return options;
}

function option(options: CliOptions, name: string, fallback?: string): string {
  const value = options[name] ?? fallback;
  if (typeof value !== "string") throw new Error(`Missing --${name}.`);
  return value;
}

function inferAdapter(url: URL): QaAdapter | null {
  if (/(^|\.)greenhouse\.io$/i.test(url.hostname)) return "GREENHOUSE";
  if (/(^|\.)lever\.co$/i.test(url.hostname)) return "LEVER";
  return null;
}

function parseUrlList(input: string): UrlEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new Error(
      `The URL list is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(parsed)) throw new Error("The URL list must be a JSON array.");
  const normalized = parsed.map((entry, index): unknown => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const record = entry as Record<string, unknown>;
    if (typeof record.adapter !== "string") return entry;
    const adapter = record.adapter.trim().toLocaleUpperCase();
    if (adapter !== "GREENHOUSE" && adapter !== "LEVER")
      throw new Error(
        `URL entry ${index + 1} has adapter "${record.adapter}". The adapter is the ATS provider, not the employer name; Phase 3 accepts only "GREENHOUSE" or "LEVER".`,
      );
    return { ...record, adapter };
  });
  return UrlListSchema.parse(normalized);
}

function rejectKnownUnsupportedAts(url: URL): void {
  if (/(^|\.)ashbyhq\.com$/i.test(url.hostname))
    throw new Error(
      `${url.hostname} is an Ashby site. This Phase 3 QA command supports only Greenhouse and Lever forms.`,
    );
  if (/(^|\.)myworkdayjobs\.com$/i.test(url.hostname))
    throw new Error(
      `${url.hostname} is a Workday site. This Phase 3 QA command supports only Greenhouse and Lever forms.`,
    );
}

function compact(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function publicAtsSiteToken(value: string, optionName: string): string {
  if (!/^[a-z0-9-]+$/i.test(value))
    throw new Error(`--${optionName} must contain only letters, numbers, and hyphens.`);
  return value;
}

async function publicJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Public ATS API returned HTTP ${response.status}.`);
  return response.json() as Promise<unknown>;
}

async function discoverCommand(options: CliOptions): Promise<void> {
  const greenhouseBoard = publicAtsSiteToken(
    option(options, "greenhouse-board", "figma"),
    "greenhouse-board",
  );
  const leverSite = publicAtsSiteToken(option(options, "lever-site", "palantir"), "lever-site");
  const perAdapter = Number(option(options, "per-adapter", "100"));
  if (!Number.isInteger(perAdapter) || perAdapter < 1 || perAdapter > 125)
    throw new Error("--per-adapter must be an integer between 1 and 125.");
  const outputPath = resolve(option(options, "output", "qa/ats/urls.local.json"));

  const greenhouseResponse = z
    .object({
      jobs: z.array(z.object({ id: z.number().int().positive(), absolute_url: z.url() })).max(5000),
    })
    .parse(await publicJson(`https://boards-api.greenhouse.io/v1/boards/${greenhouseBoard}/jobs`));
  const greenhouseUrls = greenhouseResponse.jobs
    .map((job) => job.absolute_url)
    .filter((url) => /(^|\.)greenhouse\.io$/i.test(validatePublicCaptureUrl(url).hostname));

  const leverResponse = z
    .array(z.object({ id: z.string().min(1), applyUrl: z.url() }))
    .max(5000)
    .parse(await publicJson(`https://api.lever.co/v0/postings/${leverSite}?mode=json`));
  const leverUrls = leverResponse
    .map((job) => job.applyUrl)
    .filter((url) => /(^|\.)lever\.co$/i.test(validatePublicCaptureUrl(url).hostname));

  if (greenhouseUrls.length < perAdapter)
    throw new Error(
      `Greenhouse board "${greenhouseBoard}" has only ${greenhouseUrls.length} Greenhouse-hosted public jobs; ${perAdapter} are required.`,
    );
  if (leverUrls.length < perAdapter)
    throw new Error(
      `Lever site "${leverSite}" has only ${leverUrls.length} public application URLs; ${perAdapter} are required.`,
    );

  const entries = [
    ...greenhouseUrls.slice(0, perAdapter).map((url) => ({ url, adapter: "GREENHOUSE" })),
    ...leverUrls.slice(0, perAdapter).map((url) => ({ url, adapter: "LEVER" })),
  ];
  if (new Set(entries.map((entry) => entry.url)).size !== entries.length)
    throw new Error("The public ATS APIs returned duplicate application URLs.");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(entries, null, 2)}\n`);
  console.log(
    `Wrote ${perAdapter} Greenhouse and ${perAdapter} Lever public application URLs to ${outputPath}`,
  );
}

async function captureMetadata(page: Page): Promise<PageSnapshot> {
  const captured = await page.evaluate(() => {
    const supportedInputTypes = new Set([
      "text",
      "email",
      "tel",
      "url",
      "number",
      "date",
      "month",
      "radio",
      "checkbox",
      "file",
    ]);
    const text = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
    const controls = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        "input, select, textarea",
      ),
    ).filter((control) => {
      if (control instanceof HTMLInputElement) {
        if (control.type === "password" || control.type === "hidden") return false;
        if (!supportedInputTypes.has(control.type)) return false;
      }
      if (control.hidden || control.closest("[hidden], [aria-hidden='true']")) return false;
      const style = window.getComputedStyle(control);
      return style.display !== "none" && style.visibility !== "hidden";
    });
    const occurrences = new Map<string, number>();
    const referencedText = (
      control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
      attribute: string,
    ) =>
      text(
        control
          .getAttribute(attribute)
          ?.split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" "),
      );
    const labelText = (control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) => {
      const labels = Array.from(control.labels ?? [])
        .map((label) => label.textContent ?? "")
        .join(" ");
      return text(labels || control.closest("label")?.textContent);
    };
    const groupLabel = (control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) => {
      const legend = text(control.closest("fieldset")?.querySelector("legend")?.textContent);
      if (legend) return legend;
      const applicationQuestion = control.closest(".application-question");
      if (!applicationQuestion) return "";
      const context = applicationQuestion.cloneNode(true) as HTMLElement;
      context
        .querySelectorAll(".application-field, .application-dropdown, input, select, textarea")
        .forEach((element) => element.remove());
      return text(context.textContent);
    };

    return {
      schemaVersion: 1 as const,
      url: location.href,
      title: document.title,
      capturedAt: new Date().toISOString(),
      fields: controls.slice(0, 501).map((control, index) => {
        const labels = labelText(control);
        const base = text(control.id) || text(control.getAttribute("name")) || `field-${index + 1}`;
        const occurrence = occurrences.get(base) ?? 0;
        occurrences.set(base, occurrence + 1);
        const fieldId = occurrence === 0 ? base : `${base}-${occurrence + 1}`;
        const kind =
          control instanceof HTMLTextAreaElement
            ? "textarea"
            : control instanceof HTMLSelectElement
              ? control.multiple
                ? "select-multiple"
                : "select-one"
              : control.type;
        return {
          fieldId,
          controlKind: kind,
          accessibleName:
            text(control.getAttribute("aria-label")) ||
            referencedText(control, "aria-labelledby") ||
            labels ||
            text(control.getAttribute("placeholder")) ||
            text(control.getAttribute("name")) ||
            text(control.id),
          labelText: labels,
          ariaLabel: text(control.getAttribute("aria-label")),
          placeholder: text(control.getAttribute("placeholder")),
          name: text(control.getAttribute("name")),
          domId: text(control.id),
          required: control.required || control.getAttribute("aria-required") === "true",
          disabled: control.disabled,
          readOnly: "readOnly" in control && control.readOnly,
          autocomplete: text(control.getAttribute("autocomplete")),
          groupLabel: groupLabel(control),
          optionValue:
            control instanceof HTMLInputElement && ["radio", "checkbox"].includes(control.type)
              ? text(control.getAttribute("value"))
              : "",
          checked: false,
          userEdited: false,
          options:
            control instanceof HTMLSelectElement
              ? Array.from(control.options)
                  .slice(0, 5001)
                  .map((candidate) => ({
                    value: candidate.value,
                    text: text(candidate.textContent),
                    disabled: candidate.disabled,
                  }))
              : [],
        };
      }),
    };
  });
  return PageSnapshotSchema.parse(captured);
}

async function installReadOnlyNetworkPolicy(context: BrowserContext): Promise<void> {
  await context.routeWebSocket("**/*", (socket) => socket.close());
  await context.route("**/*", async (route) => {
    const request = route.request();
    const method = request.method().toLocaleUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      await route.abort("blockedbyclient");
      return;
    }
    try {
      const target = new URL(request.url());
      if (target.protocol === "http:") throw new Error("Insecure subrequest blocked.");
      if (target.protocol === "https:") validatePublicCaptureUrl(request.url());
    } catch {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
}

async function captureCommand(options: CliOptions): Promise<void> {
  const inputPath = resolve(option(options, "input", "qa/ats/urls.local.json"));
  const outputPath = resolve(option(options, "output", ".tmp/ats-qa/captures"));
  const delayMs = Number(option(options, "delay-ms", "750"));
  if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 10_000)
    throw new Error("--delay-ms must be between 0 and 10000.");
  let input: string;
  try {
    input = await readFile(inputPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error(
        `URL list not found: ${inputPath}\nCopy qa/ats/urls.example.json to qa/ats/urls.local.json, then replace the example URLs with public application URLs.`,
      );
    throw error;
  }
  let entries = parseUrlList(input);
  const adapterFilterInput = options.adapter;
  if (adapterFilterInput !== undefined) {
    if (typeof adapterFilterInput !== "string") throw new Error("--adapter requires a value.");
    const adapterFilter = QaAdapterSchema.parse(adapterFilterInput.toLocaleUpperCase());
    entries = entries.filter((entry) => {
      const entryObject = typeof entry === "string" ? { url: entry } : entry;
      return (entryObject.adapter ?? inferAdapter(new URL(entryObject.url))) === adapterFilter;
    });
    if (!entries.length) throw new Error(`The URL list has no ${adapterFilter} entries.`);
  }
  await mkdir(outputPath, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: false,
    serviceWorkers: "block",
    javaScriptEnabled: true,
  });
  await installReadOnlyNetworkPolicy(context);
  const seen = new Set<string>();
  const capturedIds: string[] = [];
  const failures: Array<{ host: string; pathPattern: string; error: string }> = [];
  let capturedCount = 0;
  try {
    for (const entry of entries) {
      const entryObject = typeof entry === "string" ? { url: entry } : entry;
      const requestedUrl = validatePublicCaptureUrl(entryObject.url);
      rejectKnownUnsupportedAts(requestedUrl);
      const adapter = entryObject.adapter ?? inferAdapter(requestedUrl);
      if (!adapter)
        throw new Error(`Custom ATS host requires an explicit adapter: ${requestedUrl.hostname}`);
      const page = await context.newPage();
      try {
        await page.goto(requestedUrl.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForTimeout(1_000);
        const finalUrl = validatePublicCaptureUrl(page.url());
        const finalAdapter = entryObject.adapter ?? inferAdapter(finalUrl);
        if (finalAdapter && finalAdapter !== adapter)
          throw new Error(`ATS host changed after redirect for ${requestedUrl.hostname}.`);
        const rawSnapshot = await captureMetadata(page);
        const fixture = createSanitizedQaFixture(rawSnapshot, adapter, adapterVersionFor(adapter));
        if (seen.has(fixture.id)) {
          console.log(`Skipped duplicate ${fixture.id}`);
          continue;
        }
        seen.add(fixture.id);
        await writeFile(
          join(outputPath, `${fixture.id}.json`),
          `${JSON.stringify(fixture, null, 2)}\n`,
        );
        capturedIds.push(fixture.id);
        capturedCount += 1;
        console.log(`Captured ${fixture.id} (${fixture.snapshot.fields.length} fields)`);
      } catch (error) {
        const safeError = sanitizeMetadata(error instanceof Error ? error.message : String(error));
        failures.push({
          host: requestedUrl.hostname,
          pathPattern: pathPattern(requestedUrl.pathname),
          error: safeError,
        });
        console.warn(`Capture failed for ${requestedUrl.hostname}: ${safeError}`);
      } finally {
        await page.close();
      }
      if (delayMs) await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
  } finally {
    await context.close();
    await browser.close();
  }
  const summaryPath = join(dirname(outputPath), "capture-summary.json");
  await writeFile(
    summaryPath,
    `${JSON.stringify(
      {
        summaryVersion: 1,
        completedAt: new Date().toISOString(),
        requested: entries.length,
        captured: capturedIds,
        failures,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Wrote ${capturedCount} sanitized fixtures to ${outputPath}`);
  console.log(`Wrote capture summary to ${summaryPath}`);
}

async function jsonFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(directory, entry.name))
    .sort();
}

async function readFixtures(directory: string): Promise<AtsQaFixture[]> {
  let paths: string[];
  try {
    paths = await jsonFiles(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error(
        `No capture directory found: ${directory}\nRun ats:qa:capture successfully before initializing reviews or replaying fixtures.`,
      );
    throw error;
  }
  if (!paths.length)
    throw new Error(
      `No sanitized capture fixtures found in ${directory}. Run ats:qa:capture successfully first.`,
    );
  return Promise.all(
    paths.map(async (path) => AtsQaFixtureSchema.parse(JSON.parse(await readFile(path, "utf8")))),
  );
}

async function readReviews(directory: string): Promise<Map<string, AtsQaReview>> {
  const reviews = new Map<string, AtsQaReview>();
  try {
    for (const path of await jsonFiles(directory)) {
      const review = AtsQaReviewSchema.parse(JSON.parse(await readFile(path, "utf8")));
      reviews.set(review.fixtureId, review);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return reviews;
}

async function initReviewCommand(options: CliOptions): Promise<void> {
  const capturesPath = resolve(option(options, "captures", ".tmp/ats-qa/captures"));
  const reviewsPath = resolve(option(options, "reviews", ".tmp/ats-qa/reviews"));
  await mkdir(reviewsPath, { recursive: true });
  const existing = await readReviews(reviewsPath);
  const force = options.force === true;
  let created = 0;
  let replaced = 0;
  const fixtures = await readFixtures(capturesPath);
  for (const fixture of fixtures) {
    if (existing.has(fixture.id) && !force) continue;
    const review = createReviewTemplate(fixture);
    await writeFile(
      join(reviewsPath, `${fixture.id}.review.json`),
      `${JSON.stringify(review, null, 2)}\n`,
    );
    if (existing.has(fixture.id)) replaced += 1;
    else created += 1;
  }
  console.log(
    `Review templates: ${created} created, ${replaced} replaced, ${fixtures.length - created - replaced} already existed in ${reviewsPath}`,
  );
}

async function replayCommand(options: CliOptions): Promise<void> {
  const capturesPath = resolve(option(options, "captures", ".tmp/ats-qa/captures"));
  const reviewsPath = resolve(option(options, "reviews", ".tmp/ats-qa/reviews"));
  const reportPath = resolve(option(options, "report", ".tmp/ats-qa/report"));
  const fixtures = await readFixtures(capturesPath);
  const reviews = await readReviews(reviewsPath);
  const results = fixtures.map((fixture) => evaluateQaFixture(fixture, reviews.get(fixture.id)));
  const report = aggregateQaResults(results);
  await mkdir(reportPath, { recursive: true });
  await writeFile(join(reportPath, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(reportPath, "report.md"), qaReportMarkdown(report));
  const checklistInputPath = resolve(option(options, "input", "qa/ats/urls.local.json"));
  try {
    const entries = parseUrlList(await readFile(checklistInputPath, "utf8"));
    const fixtureIds = new Set(fixtures.map((fixture) => fixture.id));
    const rows = entries.flatMap((entry) => {
      const entryObject = typeof entry === "string" ? { url: entry } : entry;
      const url = validatePublicCaptureUrl(entryObject.url);
      const adapter = entryObject.adapter ?? inferAdapter(url);
      if (!adapter) return [];
      const fixtureId = qaFixtureIdForUrl(url.href, adapter);
      if (!fixtureIds.has(fixtureId)) return [];
      const pageReview = reviews.get(fixtureId)?.pageChecks;
      const checkbox = (value: "UNREVIEWED" | "PASS" | "FAIL" | undefined) =>
        value === "PASS" ? "[x]" : "[ ]";
      return [
        `| ${checkbox(pageReview?.correctAts)} | ${checkbox(pageReview?.allVisibleFieldsCaptured)} | ${checkbox(pageReview?.containsNoPersonalData)} | ${checkbox(pageReview?.noFormInteractionOccurred)} | ${adapter} | [open public form](<${url.href}>) | [${fixtureId}](../captures/${fixtureId}.json) |`,
      ];
    });
    await writeFile(
      join(reportPath, "page-checklist.md"),
      `# ATS QA page checklist\n\nDo not type, upload, or submit. For every row, compare the public form with the sanitized fixture and tick all four checks.\n\n| Correct ATS | All visible controls captured | No personal/session data | No interaction occurred | ATS | Public form | Fixture |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}\n`,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  console.log(
    compact(
      `QA report: ${report.totals.greenhouseForms} Greenhouse, ${report.totals.leverForms} Lever, ${report.totals.pendingReviewItems} pending field reviews, gate ${report.gate.passed ? "PASS" : "NOT YET PASSED"}`,
    ),
  );
  console.log(`Wrote ${join(reportPath, "report.md")}`);
  if (options.enforce && !report.gate.passed) process.exitCode = 2;
}

type ImportedBatchDecision = "CORRECT" | "UNMAPPED" | "UNSUPPORTED";

function reviewedBatchDecisions(markdown: string): Map<string, ImportedBatchDecision> {
  const decisions = new Map<string, ImportedBatchDecision>();
  const pattern = /\|\s*(batch-[a-f0-9]{16})\s*\|\s*(CORRECT|UNMAPPED|UNSUPPORTED)\s*\|/g;
  for (const match of markdown.matchAll(pattern)) {
    const batchId = match[1]!;
    const decision = match[2] as ImportedBatchDecision;
    if (decisions.has(batchId)) throw new Error(`Duplicate reviewed batch ID: ${batchId}.`);
    decisions.set(batchId, decision);
  }
  return decisions;
}

type ImportedPageChecks = {
  correctAts: boolean;
  allVisibleFieldsCaptured: boolean;
  containsNoPersonalData: boolean;
  noFormInteractionOccurred: boolean;
};

function reviewedPageChecks(markdown: string): Map<string, ImportedPageChecks> {
  const pages = new Map<string, ImportedPageChecks>();
  for (const line of markdown.split(/\r?\n/)) {
    const checks =
      /^\|\s*\[([ xX])\]\s*\|\s*\[([ xX])\]\s*\|\s*\[([ xX])\]\s*\|\s*\[([ xX])\]/.exec(line);
    if (!checks) continue;
    const fixtureId = /\[((?:greenhouse|lever)-[a-f0-9]{16})\]\(\.\.\/captures\//.exec(line)?.[1];
    if (!fixtureId) continue;
    if (pages.has(fixtureId)) throw new Error(`Duplicate reviewed fixture ID: ${fixtureId}.`);
    const checked = (value: string | undefined) => value?.toLocaleLowerCase() === "x";
    pages.set(fixtureId, {
      correctAts: checked(checks[1]),
      allVisibleFieldsCaptured: checked(checks[2]),
      containsNoPersonalData: checked(checks[3]),
      noFormInteractionOccurred: checked(checks[4]),
    });
  }
  return pages;
}

async function importReviewedCommand(options: CliOptions): Promise<void> {
  const reportReviewedPath = resolve(option(options, "report-reviewed"));
  const pageChecklistReviewedPath = resolve(option(options, "page-checklist-reviewed"));
  const capturesPath = resolve(option(options, "captures", ".tmp/ats-qa/captures"));
  const reviewsPath = resolve(option(options, "reviews", ".tmp/ats-qa/reviews"));
  const reportPath = resolve(option(options, "report", ".tmp/ats-qa/report"));
  const reviewer = option(options, "reviewer", "manual-review");
  const reportMarkdown = await readFile(reportReviewedPath, "utf8");
  const checklistMarkdown = await readFile(pageChecklistReviewedPath, "utf8");
  const decisions = reviewedBatchDecisions(reportMarkdown);
  const pageChecks = reviewedPageChecks(checklistMarkdown);
  const fixtures = await readFixtures(capturesPath);
  const pendingResults = fixtures.map((fixture) => evaluateQaFixture(fixture));
  const currentReport = aggregateQaResults(pendingResults);
  const expectedBatchIds = new Set(currentReport.manualReviewBatches.map((batch) => batch.id));
  const fixtureIds = new Set(fixtures.map((fixture) => fixture.id));
  if (decisions.size !== expectedBatchIds.size)
    throw new Error(
      `Reviewed report has ${decisions.size} batch decisions; ${expectedBatchIds.size} are required.`,
    );
  if ([...decisions.keys()].some((batchId) => !expectedBatchIds.has(batchId)))
    throw new Error("Reviewed report contains a batch ID that is not in the current QA report.");
  if (pageChecks.size !== fixtures.length)
    throw new Error(
      `Reviewed checklist has ${pageChecks.size} fixture rows; ${fixtures.length} are required.`,
    );
  if ([...pageChecks.keys()].some((fixtureId) => !fixtureIds.has(fixtureId)))
    throw new Error("Reviewed checklist contains a fixture ID that is not in the capture set.");

  await mkdir(reviewsPath, { recursive: true });
  for (const fixture of fixtures) {
    const template = createReviewTemplate(fixture);
    const fieldsById = new Map(fixture.snapshot.fields.map((field) => [field.fieldId, field]));
    const fields = template.fields.map((fieldReview) => {
      const context = fieldReview.reviewContext;
      const field = fieldsById.get(fieldReview.fieldId);
      if (!context || !field) throw new Error(`Missing review context for ${fieldReview.fieldId}.`);
      const queueItem: QaReviewQueueItem = {
        fixtureId: fixture.id,
        adapter: fixture.adapter,
        fieldId: fieldReview.fieldId,
        label: context.capturedLabel,
        predictedCanonicalQuestion: context.predictedCanonicalQuestion,
        confidence: context.confidence,
        tier: context.tier,
        priority: context.priority,
        reasons: context.reasons,
        severityIfWrong: fieldReview.severityIfWrong,
        controlKind: field.controlKind,
        required: field.required,
      };
      const batchId = manualReviewBatchId(queueItem);
      const decision = decisions.get(batchId);
      if (!decision) throw new Error(`No imported decision for ${batchId}.`);
      const base = {
        fieldId: fieldReview.fieldId,
        severityIfWrong: fieldReview.severityIfWrong,
        reviewContext: context,
        notes: `Imported from reviewed batch ${batchId}.`,
      };
      if (decision === "CORRECT") {
        if (!context.predictedCanonicalQuestion)
          throw new Error(`Batch ${batchId} is CORRECT but has no predicted mapping.`);
        return {
          ...base,
          decision: "MAPPED" as const,
          expectedCanonicalQuestion: context.predictedCanonicalQuestion,
        };
      }
      if (decision === "UNSUPPORTED")
        return { ...base, decision: "UNSUPPORTED" as const, reason: "Manual review decision." };
      return { ...base, decision: "UNMAPPED" as const };
    });
    const imported = pageChecks.get(fixture.id)!;
    const asCheck = (value: boolean) => (value ? ("PASS" as const) : ("UNREVIEWED" as const));
    const pageReview = {
      correctAts: asCheck(imported.correctAts),
      allVisibleFieldsCaptured: asCheck(imported.allVisibleFieldsCaptured),
      containsNoPersonalData: asCheck(imported.containsNoPersonalData),
      noFormInteractionOccurred: asCheck(imported.noFormInteractionOccurred),
    };
    const fullyChecked = Object.values(pageReview).every((value) => value === "PASS");
    const review = AtsQaReviewSchema.parse({
      ...template,
      status: fullyChecked ? "REVIEWED" : "PENDING",
      reviewer,
      ...(fullyChecked ? { reviewedAt: new Date().toISOString() } : {}),
      pageChecks: pageReview,
      fields,
    });
    await writeFile(
      join(reviewsPath, `${fixture.id}.review.json`),
      `${JSON.stringify(review, null, 2)}\n`,
    );
  }

  const digest = (value: string) => createHash("sha256").update(value).digest("hex");
  const decisionCounts = Object.fromEntries(
    (["CORRECT", "UNMAPPED", "UNSUPPORTED"] as const).map((decision) => [
      decision,
      [...decisions.values()].filter((candidate) => candidate === decision).length,
    ]),
  );
  const checkedCount = (select: (checks: ImportedPageChecks) => boolean) =>
    [...pageChecks.values()].filter(select).length;
  await mkdir(reportPath, { recursive: true });
  await writeFile(
    join(reportPath, "review-import-summary.json"),
    `${JSON.stringify(
      {
        importVersion: 1,
        importedAt: new Date().toISOString(),
        reviewer,
        sources: {
          reportReviewedSha256: digest(reportMarkdown),
          pageChecklistReviewedSha256: digest(checklistMarkdown),
        },
        batchDecisions: decisionCounts,
        pageChecks: {
          total: pageChecks.size,
          correctAts: checkedCount((checks) => checks.correctAts),
          allVisibleFieldsCaptured: checkedCount((checks) => checks.allVisibleFieldsCaptured),
          containsNoPersonalData: checkedCount((checks) => checks.containsNoPersonalData),
          noFormInteractionOccurred: checkedCount((checks) => checks.noFormInteractionOccurred),
        },
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `Imported ${decisions.size} batch decisions and ${pageChecks.size} page rows into ${reviewsPath}`,
  );
}

async function signoffPagesCommand(options: CliOptions): Promise<void> {
  if (options["confirm-all"] !== true)
    throw new Error(
      "Page signoff requires --confirm-all after a person has completed all four checks for every captured page.",
    );
  const reviewer = option(options, "reviewer");
  const capturesPath = resolve(option(options, "captures", ".tmp/ats-qa/captures"));
  const reviewsPath = resolve(option(options, "reviews", ".tmp/ats-qa/reviews"));
  const reportPath = resolve(option(options, "report", ".tmp/ats-qa/report"));
  const fixtures = await readFixtures(capturesPath);
  const reviews = await readReviews(reviewsPath);

  if (reviews.size !== fixtures.length)
    throw new Error(
      `Found ${reviews.size} review files for ${fixtures.length} fixtures. Initialize and complete every review before page signoff.`,
    );

  for (const fixture of fixtures) {
    const review = reviews.get(fixture.id);
    if (!review) throw new Error(`Missing review for fixture ${fixture.id}.`);
    const fixtureFieldIds = new Set(fixture.snapshot.fields.map((field) => field.fieldId));
    const reviewedFieldIds = new Set(review.fields.map((field) => field.fieldId));
    if (
      review.fields.length !== fixture.snapshot.fields.length ||
      reviewedFieldIds.size !== fixtureFieldIds.size ||
      [...fixtureFieldIds].some((fieldId) => !reviewedFieldIds.has(fieldId)) ||
      review.fields.some((field) => field.decision === "UNREVIEWED")
    )
      throw new Error(`Field review is incomplete for fixture ${fixture.id}.`);
  }

  const signedOffAt = new Date().toISOString();
  for (const fixture of fixtures) {
    const current = reviews.get(fixture.id)!;
    const signedOff = AtsQaReviewSchema.parse({
      ...current,
      status: "REVIEWED",
      reviewer,
      reviewedAt: signedOffAt,
      pageChecks: {
        correctAts: "PASS",
        allVisibleFieldsCaptured: "PASS",
        containsNoPersonalData: "PASS",
        noFormInteractionOccurred: "PASS",
      },
    });
    await writeFile(
      join(reviewsPath, `${fixture.id}.review.json`),
      `${JSON.stringify(signedOff, null, 2)}\n`,
    );
  }

  await mkdir(reportPath, { recursive: true });
  await writeFile(
    join(reportPath, "page-signoff-summary.json"),
    `${JSON.stringify(
      {
        signoffVersion: 1,
        signedOffAt,
        reviewer,
        fixtureCount: fixtures.length,
        explicitConfirmation: true,
        checks: {
          correctAts: "PASS",
          allVisibleFieldsCaptured: "PASS",
          containsNoPersonalData: "PASS",
          noFormInteractionOccurred: "PASS",
        },
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Signed off all four page checks for ${fixtures.length} fixtures as ${reviewer}.`);
}

async function reconcileWorkAuthCommand(options: CliOptions): Promise<void> {
  if (options["confirm-distinction"] !== true)
    throw new Error(
      "Work-authorization reconciliation requires --confirm-distinction to acknowledge that combined current/future sponsorship questions must remain manual.",
    );
  const capturesPath = resolve(option(options, "captures", ".tmp/ats-qa/captures"));
  const reviewsPath = resolve(option(options, "reviews", ".tmp/ats-qa/reviews"));
  const reportPath = resolve(option(options, "report", ".tmp/ats-qa/report"));
  const fixtures = await readFixtures(capturesPath);
  const reviews = await readReviews(reviewsPath);
  let correctedFields = 0;
  const correctedFixtures = new Set<string>();

  for (const fixture of fixtures) {
    const current = reviews.get(fixture.id);
    if (!current) throw new Error(`Missing review for fixture ${fixture.id}.`);
    const fieldsById = new Map(fixture.snapshot.fields.map((field) => [field.fieldId, field]));
    const fields = current.fields.map((fieldReview) => {
      const field = fieldsById.get(fieldReview.fieldId);
      const question = compact(
        field?.groupLabel || field?.accessibleName || field?.labelText || field?.name || "",
      ).toLocaleLowerCase();
      const combinedTiming =
        /\b(now|current|currently|today|present)\b/.test(question) &&
        /\b(future|later|eventually)\b/.test(question);
      if (
        fieldReview.decision !== "MAPPED" ||
        fieldReview.expectedCanonicalQuestion !== "WORK_AUTH.current_sponsorship" ||
        !/\bsponsor(ship|ed|ing)?\b/.test(question) ||
        !combinedTiming
      )
        return fieldReview;
      correctedFields += 1;
      correctedFixtures.add(fixture.id);
      return {
        fieldId: fieldReview.fieldId,
        decision: "UNMAPPED" as const,
        severityIfWrong: fieldReview.severityIfWrong,
        ...(fieldReview.reviewContext ? { reviewContext: fieldReview.reviewContext } : {}),
        notes:
          "Phase 4 safety correction: combined current/future sponsorship cannot reuse either answer independently.",
      };
    });
    const corrected = AtsQaReviewSchema.parse({ ...current, fields });
    await writeFile(
      join(reviewsPath, `${fixture.id}.review.json`),
      `${JSON.stringify(corrected, null, 2)}\n`,
    );
  }

  await mkdir(reportPath, { recursive: true });
  await writeFile(
    join(reportPath, "work-auth-correction-summary.json"),
    `${JSON.stringify(
      {
        correctionVersion: 1,
        correctedAt: new Date().toISOString(),
        policy:
          "Combined current/future sponsorship questions remain manual because the stored answers are distinct.",
        correctedFields,
        correctedFixtures: correctedFixtures.size,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `Corrected ${correctedFields} combined-sponsorship field decisions across ${correctedFixtures.size} fixtures.`,
  );
}

async function seedControlledCommand(options: CliOptions): Promise<void> {
  const outputPath = resolve(option(options, "output", ".tmp/ats-qa-controlled/captures"));
  await mkdir(outputPath, { recursive: true });
  for (const adapter of ["GREENHOUSE", "LEVER"] as const) {
    const legacyPath = resolve(`fixtures/ats/${adapter.toLocaleLowerCase()}/v1/application.json`);
    const legacy = z
      .object({ snapshot: PageSnapshotSchema })
      .parse(JSON.parse(await readFile(legacyPath, "utf8")));
    const fixture = createSanitizedQaFixture(legacy.snapshot, adapter, adapterVersionFor(adapter));
    await writeFile(
      join(outputPath, `${fixture.id}.json`),
      `${JSON.stringify(fixture, null, 2)}\n`,
    );
  }
  console.log(`Seeded controlled Greenhouse and Lever captures in ${outputPath}`);
}

function usage(): string {
  return `ATS QA commands:
  discover [--greenhouse-board figma] [--lever-site palantir] [--per-adapter 100] [--output qa/ats/urls.local.json]
  capture --input qa/ats/urls.local.json [--adapter GREENHOUSE|LEVER] [--output .tmp/ats-qa/captures] [--delay-ms 750]
  init-review [--captures .tmp/ats-qa/captures] [--reviews .tmp/ats-qa/reviews] [--force]
  replay [--captures ...] [--reviews ...] [--report .tmp/ats-qa/report] [--input qa/ats/urls.local.json] [--enforce]
  import-reviewed --report-reviewed path --page-checklist-reviewed path [--reviewer name]
  signoff-pages --confirm-all --reviewer name [--captures ...] [--reviews ...] [--report ...]
  reconcile-work-auth --confirm-distinction [--captures ...] [--reviews ...] [--report ...]
  seed-controlled [--output .tmp/ats-qa-controlled/captures]`;
}

const [command, ...args] = process.argv.slice(2);
const options = parseOptions(args);
try {
  if (command === "discover") await discoverCommand(options);
  else if (command === "capture") await captureCommand(options);
  else if (command === "init-review") await initReviewCommand(options);
  else if (command === "replay") await replayCommand(options);
  else if (command === "import-reviewed") await importReviewedCommand(options);
  else if (command === "signoff-pages") await signoffPagesCommand(options);
  else if (command === "reconcile-work-auth") await reconcileWorkAuthCommand(options);
  else if (command === "seed-controlled") await seedControlledCommand(options);
  else throw new Error(usage());
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
