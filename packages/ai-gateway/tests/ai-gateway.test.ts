import { describe, expect, it } from "vitest";

import {
  AiGatewayError,
  createFixtureProvider,
  createOpenAiProvider,
  executeAiTask,
  type AiTaskRequest,
} from "../src/index";

const classifyRequest: AiTaskRequest = {
  task: "QUESTION_CLASSIFY",
  question: "Why do you want this role?",
  controlKind: "textarea",
};

describe("AI gateway", () => {
  it("validates provider-independent structured output and records redacted audit metadata", async () => {
    const provider = createFixtureProvider(() => ({
      task: "QUESTION_CLASSIFY",
      canonicalQuestion: "ESSAY.why_role",
      confidence: 0.99,
      reason: "Open-text role motivation.",
    }));
    const result = await executeAiTask(provider, classifyRequest);
    expect(result.output).toMatchObject({ canonicalQuestion: "ESSAY.why_role" });
    expect(result.audit).toMatchObject({ provider: "FIXTURE", task: "QUESTION_CLASSIFY" });
    expect(result.audit).not.toHaveProperty("question");
  });

  it("rejects malformed or task-mismatched provider output", async () => {
    const malformed = createFixtureProvider(
      () => ({ task: "QUESTION_CLASSIFY", canonicalQuestion: null }) as never,
    );
    await expect(executeAiTask(malformed, classifyRequest, { retries: 0 })).rejects.toMatchObject({
      code: "INVALID_OUTPUT",
    });

    const mismatched = createFixtureProvider(
      () =>
        ({
          task: "FREE_TEXT_GENERATE",
          answer: "x",
          evidenceIds: ["e"],
          claims: [],
          unsupportedClaims: [],
        }) as never,
    );
    await expect(executeAiTask(mismatched, classifyRequest, { retries: 0 })).rejects.toBeInstanceOf(
      AiGatewayError,
    );
  });

  it("uses Responses structured output without tools or storage", async () => {
    let body: Record<string, unknown> | undefined;
    const fetchMock: typeof fetch = (_input, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
      body = JSON.parse(init.body) as Record<string, unknown>;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      task: "QUESTION_CLASSIFY",
                      canonicalQuestion: "ESSAY.why_role",
                      confidence: 0.95,
                      reason: "Role question.",
                    }),
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    };
    const provider = createOpenAiProvider({
      apiKey: "test-key",
      model: "test-model",
      fetch: fetchMock,
    });
    await executeAiTask(provider, classifyRequest, { retries: 0 });
    expect(body).toMatchObject({ store: false, tools: [] });
    expect(body?.text).toMatchObject({ format: { type: "json_schema", strict: true } });
    expect(JSON.stringify(body)).not.toContain("test-key");
  });
});
