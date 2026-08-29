import {
  ApplicationRecordSchema,
  ApplicationTrackerSchema,
  type ApplicationPageAnalysis,
  type ApplicationRecord,
  type ApplicationTracker,
  type ConfirmationEvidence,
} from "@copilot/job-schema";

export function createEmptyTracker(now = new Date().toISOString()): ApplicationTracker {
  return ApplicationTrackerSchema.parse({ trackerVersion: 1, updatedAt: now, applications: [] });
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

export function recordApplying(
  trackerInput: ApplicationTracker,
  analysis: ApplicationPageAnalysis,
  profileVersion: number,
  now = new Date().toISOString(),
): ApplicationTracker {
  if (!analysis.applicationId || !analysis.job) return ApplicationTrackerSchema.parse(trackerInput);
  const tracker = ApplicationTrackerSchema.parse(trackerInput);
  const existing = tracker.applications.find((item) => item.id === analysis.applicationId);
  const record = ApplicationRecordSchema.parse({
    ...(existing ?? {}),
    id: analysis.applicationId,
    canonicalJobId: analysis.job.id,
    profileVersion: existing?.profileVersion ?? profileVersion,
    discoveredAt: existing?.discoveredAt ?? now,
    updatedAt: now,
    sourceUrl: existing?.sourceUrl ?? analysis.job.sourceUrl,
    applicationUrl: existing?.applicationUrl ?? analysis.job.applicationUrl,
    status: existing?.status === "APPLIED" ? "APPLIED" : "APPLYING",
    ats: analysis.ats.adapter,
    job: existing?.job ?? analysis.job,
  });
  return replaceRecord(tracker, record, now);
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
