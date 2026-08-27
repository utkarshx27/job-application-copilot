import { z } from "zod";

export const SitePolicySchema = z.object({
  hostPattern: z.string().min(1),
  mode: z.enum(["SUPPORTED", "ASSIST_ONLY", "MANUAL_ONLY", "BLOCKED", "UNKNOWN"]),
  fillAllowed: z.boolean(),
  navigationAllowed: z.boolean(),
  submissionAllowed: z.boolean(),
  notes: z.string().optional(),
});

export type SitePolicy = z.infer<typeof SitePolicySchema>;

export function policyForUrl(url: string): SitePolicy {
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();

  if (hostname === "linkedin.com" || hostname.endsWith(".linkedin.com")) {
    return {
      hostPattern: "*.linkedin.com",
      mode: "MANUAL_ONLY",
      fillAllowed: false,
      navigationAllowed: false,
      submissionAllowed: false,
      notes: "Automation on LinkedIn is outside product scope.",
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      hostPattern: hostname || parsed.protocol,
      mode: "BLOCKED",
      fillAllowed: false,
      navigationAllowed: false,
      submissionAllowed: false,
      notes: "Only HTTP(S) application pages can be inspected.",
    };
  }

  return {
    hostPattern: hostname,
    mode: "ASSIST_ONLY",
    fillAllowed: true,
    navigationAllowed: false,
    submissionAllowed: false,
  };
}
