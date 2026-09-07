declare const __AGENT_LAB_BUILD__: boolean;

// Availability is fixed at build time. Runtime opt-in is a separate persisted flag.
export const AGENT_LAB_AVAILABLE =
  typeof __AGENT_LAB_BUILD__ !== "undefined" && __AGENT_LAB_BUILD__;
