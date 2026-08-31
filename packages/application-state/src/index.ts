import {
  ApplicationRecordSchema,
  ApplicationStatusSchema,
  ApplicationTrackerSchema,
  LegacyApplicationTrackerSchema,
  NormalizedJobSchema,
  TrackerCsvExportSchema,
  TrackerCsvImportResultSchema,
  type ApplicationPageAnalysis,
  type ApplicationRecord,
  type ApplicationStatus,
  type ApplicationTracker,
  type CanonicalJobIdentity,
  type ConfirmationEvidence,
  type DuplicateWarning,
  type JobSnapshot,
  type NormalizedJob,
  type TrackerCsvExport,
  type TrackerCsvImportResult,
  type WorkdayWorkflowPage,
} from "@copilot/job-schema";

const CSV_COLUMNS = [
  "application_id",
  "canonical_job_id",
  "company",
  "title",
  "location",
  "ats",
  "status",
  "source_url",
  "application_url",
  "external_requisition_id",
  "discovered_at",
  "applied_at",
  "updated_at",
] as const;

function hash(input: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

function normalizedText(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeApplicationUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.hostname = url.hostname.toLocaleLowerCase();
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

export function canonicalIdentityForJob(job: NormalizedJob): CanonicalJobIdentity {
  const normalizedCompany = normalizedText(job.company);
  const normalizedTitle = normalizedText(job.title);
  const normalizedLocation = normalizedText(job.location);
  const normalizedApplicationUrl = normalizeApplicationUrl(job.applicationUrl);
  const requisition = normalizedText(job.externalRequisitionId);
  const strategy = requisition ? "ATS_REQUISITION" : "APPLICATION_URL";
  const seed = requisition ? `${job.ats}:${requisition}` : normalizedApplicationUrl;
  return {
    identityVersion: 1,
    key: `job:${hash(seed)}`,
    strategy,
    normalizedCompany,
    normalizedTitle,
    normalizedLocation,
    ats: job.ats,
    ...(job.externalRequisitionId ? { externalRequisitionId: job.externalRequisitionId } : {}),
    normalizedApplicationUrl,
  };
}

const SNAPSHOT_FIELDS = [
  "title",
  "company",
  "description",
  "location",
  "remotePolicy",
  "employmentType",
  "salary",
  "requiredSkills",
  "preferredSkills",
  "sourceUrl",
  "applicationUrl",
] as const;

function fingerprintJob(job: NormalizedJob): string {
  const values = SNAPSHOT_FIELDS.map((field) => JSON.stringify(job[field] ?? null));
  return `job:${hash(values.join("|"))}`;
}

function createSnapshot(
  job: NormalizedJob,
  previous: JobSnapshot | undefined,
  now: string,
): JobSnapshot {
  const fingerprint = fingerprintJob(job);
  const changedFields = previous
    ? SNAPSHOT_FIELDS.filter(
        (field) =>
          JSON.stringify(previous.job[field] ?? null) !== JSON.stringify(job[field] ?? null),
      )
    : [...SNAPSHOT_FIELDS];
  return {
    snapshotVersion: 1,
    snapshotId: `snapshot:${hash(`${now}|${fingerprint}|${job.id}`)}`,
    capturedAt: now,
    fingerprint,
    changedFields,
    job,
  };
}

export function createEmptyTracker(now = new Date().toISOString()): ApplicationTracker {
  return ApplicationTrackerSchema.parse({ trackerVersion: 2, updatedAt: now, applications: [] });
}

export function migrateApplicationTracker(
  trackerInput: unknown,
  now = new Date().toISOString(),
): ApplicationTracker {
  const current = ApplicationTrackerSchema.safeParse(trackerInput);
  if (current.success) return current.data;
  const legacy = LegacyApplicationTrackerSchema.safeParse(trackerInput);
  if (!legacy.success) return createEmptyTracker(now);
  return ApplicationTrackerSchema.parse({
    trackerVersion: 2,
    updatedAt: legacy.data.updatedAt,
    applications: legacy.data.applications.map((record) => ({
      ...record,
      canonicalIdentity: canonicalIdentityForJob(record.job),
      snapshots: [createSnapshot(record.job, undefined, record.job.snapshotAt)],
    })),
  });
}

function replaceRecord(
  trackerInput: ApplicationTracker,
  recordInput: ApplicationRecord,
  now: string,
): ApplicationTracker {
  const tracker = ApplicationTrackerSchema.parse(trackerInput);
  const record = ApplicationRecordSchema.parse(recordInput);
  return ApplicationTrackerSchema.parse({
    ...tracker,
    updatedAt: now,
    applications: [record, ...tracker.applications.filter((item) => item.id !== record.id)],
  });
}

function warningForRecord(
  record: ApplicationRecord,
  applicationId: string,
  identity: CanonicalJobIdentity,
): DuplicateWarning | null {
  if (record.id === applicationId) {
    return {
      kind: "ALREADY_TRACKED",
      confidence: 1,
      existingApplicationId: record.id,
      message: `This job is already tracked as ${record.status.toLocaleLowerCase()}.`,
      evidence: ["Same application record"],
    };
  }
  if (
    identity.externalRequisitionId &&
    record.canonicalIdentity.externalRequisitionId &&
    identity.ats === record.canonicalIdentity.ats &&
    normalizedText(identity.externalRequisitionId) ===
      normalizedText(record.canonicalIdentity.externalRequisitionId)
  ) {
    return {
      kind: "EXACT_REQUISITION",
      confidence: 1,
      existingApplicationId: record.id,
      message: "A tracked application has the same ATS requisition ID.",
      evidence: [`${identity.ats} requisition ${identity.externalRequisitionId}`],
    };
  }
  if (identity.normalizedApplicationUrl === record.canonicalIdentity.normalizedApplicationUrl) {
    return {
      kind: "EXACT_APPLICATION_URL",
      confidence: 0.99,
      existingApplicationId: record.id,
      message: "A tracked application uses the same canonical application URL.",
      evidence: [identity.normalizedApplicationUrl],
    };
  }
  if (
    identity.normalizedCompany === record.canonicalIdentity.normalizedCompany &&
    identity.normalizedTitle === record.canonicalIdentity.normalizedTitle &&
    identity.normalizedLocation === record.canonicalIdentity.normalizedLocation
  ) {
    return {
      kind: "MATCHING_JOB_DETAILS",
      confidence: 0.92,
      existingApplicationId: record.id,
      message: "A tracked application has matching company, title, and location details.",
      evidence: [
        `Company: ${identity.normalizedCompany}`,
        `Title: ${identity.normalizedTitle}`,
        `Location: ${identity.normalizedLocation || "not specified"}`,
      ],
    };
  }
  return null;
}

export function findDuplicateWarnings(
  trackerInput: ApplicationTracker,
  applicationId: string,
  job: NormalizedJob,
): DuplicateWarning[] {
  const tracker = ApplicationTrackerSchema.parse(trackerInput);
  const identity = canonicalIdentityForJob(job);
  return tracker.applications
    .map((record) => warningForRecord(record, applicationId, identity))
    .filter((warning): warning is DuplicateWarning => warning !== null)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 20);
}

export function recordApplying(
  trackerInput: ApplicationTracker,
  analysis: ApplicationPageAnalysis,
  profileVersion: number,
  now = new Date().toISOString(),
): ApplicationTracker {
  if (!analysis.applicationId || !analysis.job) return ApplicationTrackerSchema.parse(trackerInput);
  const tracker = ApplicationTrackerSchema.parse(trackerInput);
  const existing = tracker.applications.find((item) => item.id === analysis.applicationId);
  const previousSnapshot = existing?.snapshots.at(-1);
  const nextSnapshot = createSnapshot(analysis.job, previousSnapshot, now);
  const snapshots =
    previousSnapshot?.fingerprint === nextSnapshot.fingerprint
      ? (existing?.snapshots ?? [nextSnapshot])
      : [...(existing?.snapshots ?? []), nextSnapshot].slice(-50);
  const canonicalIdentity = canonicalIdentityForJob(analysis.job);
  const record = ApplicationRecordSchema.parse({
    ...(existing ?? {}),
    id: analysis.applicationId,
    canonicalJobId: canonicalIdentity.key,
    canonicalIdentity,
    snapshots,
    profileVersion: existing?.profileVersion ?? profileVersion,
    discoveredAt: existing?.discoveredAt ?? now,
    updatedAt: now,
    sourceUrl: analysis.job.sourceUrl,
    applicationUrl: analysis.job.applicationUrl,
    status: existing?.status === "APPLIED" ? "APPLIED" : (existing?.status ?? "APPLYING"),
    ats: analysis.ats.adapter,
    job: analysis.job,
  });
  return replaceRecord(tracker, record, now);
}

export function updateApplicationStatus(
  trackerInput: ApplicationTracker,
  applicationId: string,
  statusInput: ApplicationStatus,
  now = new Date().toISOString(),
): ApplicationTracker {
  const tracker = ApplicationTrackerSchema.parse(trackerInput);
  const status = ApplicationStatusSchema.parse(statusInput);
  const existing = tracker.applications.find((item) => item.id === applicationId);
  if (!existing) throw new Error(`Application ${applicationId} was not found.`);
  return replaceRecord(
    tracker,
    {
      ...existing,
      status,
      updatedAt: now,
      ...(status === "APPLIED" && !existing.appliedAt ? { appliedAt: now } : {}),
    },
    now,
  );
}

export function recordResumeUpload(
  trackerInput: ApplicationTracker,
  applicationId: string,
  fileName: string,
  sha256: string,
  now = new Date().toISOString(),
): ApplicationTracker {
  const tracker = ApplicationTrackerSchema.parse(trackerInput);
  const existing = tracker.applications.find((item) => item.id === applicationId);
  if (!existing) return tracker;
  return replaceRecord(
    tracker,
    { ...existing, resumeFileName: fileName, resumeSha256: sha256, updatedAt: now },
    now,
  );
}

export function recordConfirmation(
  trackerInput: ApplicationTracker,
  applicationId: string,
  confirmation: ConfirmationEvidence,
  now = new Date().toISOString(),
): ApplicationTracker {
  const tracker = ApplicationTrackerSchema.parse(trackerInput);
  const existing = tracker.applications.find((item) => item.id === applicationId);
  if (!existing || !confirmation.confirmed) return tracker;
  return replaceRecord(
    tracker,
    {
      ...existing,
      status: "APPLIED",
      appliedAt: existing.appliedAt ?? now,
      updatedAt: now,
      confirmation,
    },
    now,
  );
}

export function recordWorkdayWorkflow(
  trackerInput: ApplicationTracker,
  applicationId: string,
  workflow: WorkdayWorkflowPage,
  now = new Date().toISOString(),
): ApplicationTracker {
  const tracker = ApplicationTrackerSchema.parse(trackerInput);
  const existing = tracker.applications.find((item) => item.id === applicationId);
  if (!existing || existing.ats !== "WORKDAY") return tracker;
  const previous = existing.workflowProgress;
  const recoveryKey = `${workflow.tenant}:${workflow.site}:${existing.canonicalJobId}`;
  const sameSession = previous?.recoveryKey === recoveryKey;
  const observedPageKeys = sameSession
    ? [
        ...previous.observedPageKeys.filter((key) => key !== workflow.pageKey),
        workflow.pageKey,
      ].slice(-50)
    : [workflow.pageKey];
  const revisitDetected = Boolean(
    sameSession &&
    previous.currentPageKey !== workflow.pageKey &&
    previous.observedPageKeys.includes(workflow.pageKey),
  );
  return replaceRecord(
    tracker,
    {
      ...existing,
      updatedAt: now,
      workflowProgress: {
        schemaVersion: 1,
        recoveryKey,
        currentPageKey: workflow.pageKey,
        currentPageType: workflow.pageType,
        ...(workflow.stepIndex ? { currentStepIndex: workflow.stepIndex } : {}),
        ...(workflow.stepCount ? { stepCount: workflow.stepCount } : {}),
        observedPageKeys,
        observationCount: sameSession ? previous.observationCount + 1 : 1,
        recovered: Boolean(sameSession),
        revisitDetected,
        lastFingerprint: workflow.fingerprint,
        lastObservedAt: now,
      },
    },
    now,
  );
}

function csvCell(value: string | undefined): string {
  const safe = value && /^[=+\-@]/.test(value) ? `'${value}` : (value ?? "");
  return `"${safe.replace(/"/g, '""')}"`;
}

export function exportTrackerCsv(trackerInput: ApplicationTracker): TrackerCsvExport {
  const tracker = ApplicationTrackerSchema.parse(trackerInput);
  const rows = tracker.applications.map((record) =>
    [
      record.id,
      record.canonicalJobId,
      record.job.company,
      record.job.title,
      record.job.location,
      record.ats,
      record.status,
      record.sourceUrl,
      record.applicationUrl,
      record.job.externalRequisitionId,
      record.discoveredAt,
      record.appliedAt,
      record.updatedAt,
    ]
      .map(csvCell)
      .join(","),
  );
  return TrackerCsvExportSchema.parse({
    formatVersion: 1,
    csv: [CSV_COLUMNS.join(","), ...rows].join("\r\n"),
    exported: rows.length,
  });
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted && character === '"' && csv[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  row.push(cell);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function importedJob(values: Record<string, string>, now: string): NormalizedJob {
  return NormalizedJobSchema.parse({
    schemaVersion: 1,
    id: values.canonical_job_id || `imported:${hash(values.application_url ?? "")}`,
    ats: values.ats,
    ...(values.external_requisition_id
      ? { externalRequisitionId: values.external_requisition_id }
      : {}),
    title: values.title,
    company: values.company,
    description: "Imported from tracker CSV.",
    ...(values.location ? { location: values.location } : {}),
    remotePolicy: "UNKNOWN",
    requiredSkills: [],
    preferredSkills: [],
    sourceUrl: values.source_url,
    applicationUrl: values.application_url,
    snapshotAt: values.updated_at || now,
  });
}

export function importTrackerCsv(
  trackerInput: ApplicationTracker,
  csv: string,
  now = new Date().toISOString(),
): TrackerCsvImportResult {
  let tracker = ApplicationTrackerSchema.parse(trackerInput);
  const rows = parseCsv(csv);
  if (rows.length === 0) throw new Error("CSV is empty.");
  const headers = rows[0]!.map((header) => header.trim().replace(/^\uFEFF/, ""));
  if (headers.join(",") !== CSV_COLUMNS.join(",")) {
    throw new Error(`CSV columns must be: ${CSV_COLUMNS.join(", ")}`);
  }
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const warnings: string[] = [];
  for (const [offset, cells] of rows.slice(1).entries()) {
    const rowNumber = offset + 2;
    if (cells.length !== headers.length) {
      skipped += 1;
      warnings.push(`Row ${rowNumber}: expected ${headers.length} columns.`);
      continue;
    }
    const values: Record<string, string> = Object.fromEntries(
      headers.map((header, index) => [header, cells[index] ?? ""]),
    );
    try {
      const job = importedJob(values, now);
      const existing = tracker.applications.find((record) => record.id === values.application_id);
      const status = ApplicationStatusSchema.parse(values.status);
      const snapshot = createSnapshot(job, existing?.snapshots.at(-1), values.updated_at || now);
      const snapshots =
        existing?.snapshots.at(-1)?.fingerprint === snapshot.fingerprint
          ? existing.snapshots
          : [...(existing?.snapshots ?? []), snapshot].slice(-50);
      const canonicalIdentity = canonicalIdentityForJob(job);
      const record = ApplicationRecordSchema.parse({
        ...(existing ?? {}),
        id: values.application_id,
        canonicalJobId: canonicalIdentity.key,
        canonicalIdentity,
        snapshots,
        profileVersion: existing?.profileVersion ?? 1,
        discoveredAt: values.discovered_at,
        ...(values.applied_at ? { appliedAt: values.applied_at } : {}),
        updatedAt: values.updated_at || now,
        sourceUrl: job.sourceUrl,
        applicationUrl: job.applicationUrl,
        status,
        ats: job.ats,
        job,
      });
      tracker = replaceRecord(tracker, record, now);
      if (existing) updated += 1;
      else imported += 1;
    } catch (error) {
      skipped += 1;
      warnings.push(
        `Row ${rowNumber}: ${error instanceof Error ? error.message : "invalid tracker data"}`,
      );
    }
  }
  return TrackerCsvImportResultSchema.parse({ tracker, imported, updated, skipped, warnings });
}
