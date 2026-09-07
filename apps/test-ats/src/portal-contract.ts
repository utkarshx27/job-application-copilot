export type ControlMode =
  "NATIVE" | "LABELLED" | "SHADOW" | "FRAME" | "NESTED_FRAME" | "COMBOBOX" | "CLOSED_SHADOW";
export type PortalField = {
  key: string;
  label: string;
  kind: "text" | "email" | "number" | "select" | "file";
  required: boolean;
  options?: string[];
};
export type PortalListing = {
  id: string;
  title: string;
  companyId: string;
  company: string;
  location: string;
  destination: string | null;
  expired: boolean;
  salary: { amount: number; currency: string; period: string } | null;
};
export type CompanyEvidence = {
  id: string;
  name: string;
  location: string;
  demo: true;
  ratings: {
    source: string;
    value: number | null;
    scale: number;
    count: number;
    retrievedAt: string;
  }[];
};
export type PublicScenario = {
  id: string;
  family: string;
  title: string;
  mode: ControlMode;
  fields: PortalField[];
  modal: boolean;
  repeatHistory: boolean;
  delayMs: number;
  replaceOnFocus: boolean;
  evidenceOnly: boolean;
  applicationAvailable: boolean;
  access: "AVAILABLE" | "LOGIN_REQUIRED" | "CHALLENGE_PRESENT";
  seed: number;
};
export type ApplicationReceipt = { applicationId: string; jobId: string; status: "ACCEPTED" };
