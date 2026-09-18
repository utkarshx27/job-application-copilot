import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  connectorAssessmentReport,
  emptyConnectorAssessment,
} from "../packages/agent-core/src/connector-assessment.ts";

const [command, argument] = process.argv.slice(2);
const privateRoot = resolve(import.meta.dirname, "../private/ag10");
if (command === "init" && !argument) {
  await mkdir(privateRoot, { recursive: true });
  for (const connector of ["LINKEDIN", "NAUKRI", "WELLFOUND", "GLASSDOOR", "EMPLOYER_ATS"]) {
    const path = resolve(privateRoot, `${connector.toLowerCase()}.json`);
    try {
      await writeFile(path, JSON.stringify(emptyConnectorAssessment(connector), null, 2) + "\n", {
        flag: "wx",
      });
      console.log(`Created ${connector} private assessment template`);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      console.log(`Kept existing ${connector} assessment`);
    }
  }
} else if (command === "report" && argument) {
  // Read/validate before creating output. Do not log raw input or schema errors,
  // which could include sensitive values accidentally placed in private records.
  try {
    const bytes = await readFile(resolve(argument));
    if (bytes.length > 1_000_000) throw new Error("Oversized assessment");
    const report = connectorAssessmentReport(JSON.parse(bytes.toString("utf8")), Date.now());
    const output = resolve(import.meta.dirname, "../test-results/ag10");
    await mkdir(output, { recursive: true });
    await writeFile(
      resolve(output, `${report.connector.toLowerCase()}.json`),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report, null, 2));
    if (report.readiness === "BLOCKED") process.exitCode = 2;
  } catch {
    console.error(
      "Assessment could not be read or validated. Check the private file against the documented schema; raw values were not logged.",
    );
    process.exitCode = 1;
  }
} else {
  console.error("Use: agent:connectors -- init | report private/ag10/<connector>.json");
  process.exitCode = 1;
}
