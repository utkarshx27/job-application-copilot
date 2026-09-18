import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const position = process.argv.indexOf("--input");
if (position < 0 || !process.argv[position + 1])
  throw new Error("Use --input path/to/anonymous-observations.json");
const input = JSON.parse(await readFile(resolve(process.argv[position + 1]), "utf8"));
if (input.realParticipantObservations !== true || !Array.isArray(input.participants))
  throw new Error(
    "Real participant observations must be explicitly attested; synthetic runs are not users.",
  );
const ids = new Set();
for (const participant of input.participants) {
  if (!/^P\d{2}$/.test(participant.id) || ids.has(participant.id))
    throw new Error("Use unique anonymous P01-style IDs");
  ids.add(participant.id);
  if (
    participant.consent !== true ||
    participant.newUser !== true ||
    typeof participant.build !== "string" ||
    !participant.build.trim() ||
    typeof participant.chromeVersion !== "string" ||
    !participant.chromeVersion.trim()
  )
    throw new Error("Each new participant requires consent and build/browser information");
  if (!Array.isArray(participant.tasks) || participant.tasks.length !== 7)
    throw new Error("Record all seven tasks, including skipped or abandoned tasks");
  if (new Set(participant.tasks.map((task) => task.id)).size !== 7)
    throw new Error("Duplicate task ID");
  for (const task of participant.tasks) {
    if (
      !Number.isInteger(task.id) ||
      task.id < 1 ||
      task.id > 7 ||
      !["completed", "abandoned", "not-attempted"].includes(task.outcome) ||
      !Number.isFinite(task.seconds) ||
      task.seconds < 0 ||
      !Number.isSafeInteger(task.assistance) ||
      task.assistance < 0
    )
      throw new Error("Invalid task observation");
  }
  if (typeof participant.distinguishedPreparedSubmittedUnknown !== "boolean")
    throw new Error("Record the participant's state-understanding observation");
}
const participants = input.participants;
const summary = {
  participants: participants.length,
  evidenceStatus:
    participants.length >= 5 ? "OBSERVATIONS_READY_FOR_REVIEW" : "INSUFFICIENT_PARTICIPANTS",
  independentlyVerifiedAttendance: false,
  releaseAccepted: false,
  stateUnderstanding: participants.filter((p) => p.distinguishedPreparedSubmittedUnknown).length,
  tasks: Array.from({ length: 7 }, (_, index) => {
    const tasks = participants.map((p) => p.tasks.find((task) => task.id === index + 1));
    const times = tasks
      .filter((task) => task.outcome !== "not-attempted")
      .map((task) => task.seconds)
      .sort((a, b) => a - b);
    return {
      id: index + 1,
      denominator: participants.length,
      completed: tasks.filter((task) => task.outcome === "completed").length,
      abandoned: tasks.filter((task) => task.outcome === "abandoned").length,
      notAttempted: tasks.filter((task) => task.outcome === "not-attempted").length,
      assistance: tasks.reduce((sum, task) => sum + task.assistance, 0),
      medianSeconds: times[Math.floor(times.length / 2)] ?? null,
      p90Seconds: times[Math.max(0, Math.ceil(times.length * 0.9) - 1)] ?? null,
    };
  }),
  next: "Review sanitized feedback and findings, record severity, address issues, and retest. This script cannot attest that participants exist or that findings have been resolved.",
};
const output = resolve(import.meta.dirname, "../test-results/usability");
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
if (participants.length < 5) process.exitCode = 1;
