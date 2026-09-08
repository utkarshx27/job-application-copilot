import { z } from "zod";
import {
  AgentBindingSchema,
  AgentObservationSchema,
  AgentProposalSchema,
  AgentStoreSchema,
  AgentTicketSchema,
} from "@copilot/agent-core";

export const ExecutionFactSchema = z
  .object({
    targetRef: z.string().max(200),
    factRef: z.string().max(200),
    profileRevision: z.number().int().nonnegative(),
    value: z.string().max(2000),
    file: z
      .object({
        name: z.literal("synthetic-resume.txt"),
        base64: z.string().max(300_000),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .optional(),
  })
  .strict();
export const ExecutionSnapshotSchema = z
  .object({
    observation: AgentObservationSchema,
    targets: z
      .array(
        z
          .object({
            id: z.uuid(),
            label: z.string().max(2000),
            semantic: z.string().max(200).optional(),
            kind: z.enum([
              "FILL_TEXT",
              "SELECT_OPTION",
              "OPEN_CONTROL",
              "ADD_ROW",
              "REMOVE_ROW",
              "NEXT",
              "UPLOAD_FILE",
            ]),
            options: z
              .array(
                z.object({ value: z.string().max(2000), label: z.string().max(2000) }).strict(),
              )
              .max(200),
          })
          .strict(),
      )
      .max(50),
    step: z.string().max(100),
    complete: z.boolean(),
    blocked: z.boolean(),
    validation: z.boolean(),
    rowCount: z.number().int().min(0).max(20),
    fixtureId: z.literal("execution-demo-v1"),
  })
  .strict();
export const ExecutionCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("OBSERVE"),
      id: z.uuid(),
      binding: AgentBindingSchema,
      fence: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("DISPATCH"),
      id: z.uuid(),
      ticket: AgentTicketSchema,
      proposal: AgentProposalSchema,
      fact: ExecutionFactSchema,
      authority: AgentStoreSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("VERIFY"),
      id: z.uuid(),
      ticket: AgentTicketSchema,
      fact: ExecutionFactSchema,
    })
    .strict(),
  z
    .object({ type: z.literal("REVOKE"), id: z.uuid(), fence: z.number().int().nonnegative() })
    .strict(),
]);
export type ExecutionCommand = z.infer<typeof ExecutionCommandSchema>;
export const EXECUTION_PORT = "copilot-local-executor-v1";
export const DEMO_FACTS: Readonly<Record<string, string>> = Object.freeze({
  name: "Nora Example",
  email: "nora@example.test",
  country: "IN",
  location: "Bengaluru",
  locationQuery: "Bengaluru",
  startDate: "2026-10-01",
  employer: "Synthetic Labs",
  resume: "synthetic-resume.txt",
});
