import {
  AiSessionConfigSchema,
  type AiConfigStatus,
  type AiSessionConfig,
} from "@copilot/ai-gateway";

const AI_CONFIG_KEY = "aiSessionConfig";

export async function getAiSessionConfig(): Promise<AiSessionConfig | null> {
  const stored = await chrome.storage.session.get(AI_CONFIG_KEY);
  const parsed = AiSessionConfigSchema.safeParse(stored[AI_CONFIG_KEY]);
  return parsed.success ? parsed.data : null;
}

export async function setAiSessionConfig(input: unknown): Promise<AiSessionConfig> {
  const config = AiSessionConfigSchema.parse(input);
  await chrome.storage.session.set({ [AI_CONFIG_KEY]: config });
  return config;
}

export async function clearAiSessionConfig(): Promise<void> {
  await chrome.storage.session.remove(AI_CONFIG_KEY);
}

export function aiConfigStatus(config: AiSessionConfig | null): AiConfigStatus {
  return config
    ? { configured: true, provider: config.provider, model: config.model }
    : { configured: false };
}
