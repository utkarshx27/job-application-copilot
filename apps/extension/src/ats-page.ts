import { inspectWithAdapters } from "@copilot/ats-core";
import { greenhouseAdapter } from "@copilot/ats-greenhouse";
import { leverAdapter } from "@copilot/ats-lever";
import { InspectedApplicationPageSchema, type AtsId } from "@copilot/job-schema";

import { scanVisibleForm } from "./scanner";

export const supportedAdapters = [greenhouseAdapter, leverAdapter];

export function adapterForId(id: AtsId) {
  return supportedAdapters.find((adapter) => adapter.id === id);
}

export function inspectApplicationPage(targetDocument: Document = document) {
  return InspectedApplicationPageSchema.parse({
    snapshot: scanVisibleForm(targetDocument),
    atsReport: inspectWithAdapters(targetDocument, supportedAdapters),
  });
}
