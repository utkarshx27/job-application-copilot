import { inspectWithAdapters } from "@copilot/ats-core";
import { ashbyAdapter } from "@copilot/ats-ashby";
import { greenhouseAdapter } from "@copilot/ats-greenhouse";
import { leverAdapter } from "@copilot/ats-lever";
import { smartRecruitersAdapter } from "@copilot/ats-smartrecruiters";
import { workdayAdapter } from "@copilot/ats-workday";
import { icimsAdapter } from "@copilot/ats-icims";
import { taleoAdapter } from "@copilot/ats-taleo";
import { workableAdapter } from "@copilot/ats-workable";
import { bambooHrAdapter } from "@copilot/ats-bamboohr";
import { jobviteAdapter } from "@copilot/ats-jobvite";
import { comeetAdapter } from "@copilot/ats-comeet";
import { InspectedApplicationPageSchema, type AtsId } from "@copilot/job-schema";

import { scanVisibleForm } from "./scanner";

export const supportedAdapters = [
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  smartRecruitersAdapter,
  workdayAdapter,
  icimsAdapter,
  taleoAdapter,
  workableAdapter,
  bambooHrAdapter,
  jobviteAdapter,
  comeetAdapter,
];

export function adapterForId(id: AtsId) {
  return supportedAdapters.find((adapter) => adapter.id === id);
}

export function inspectApplicationPage(targetDocument: Document = document) {
  return InspectedApplicationPageSchema.parse({
    snapshot: scanVisibleForm(targetDocument),
    atsReport: inspectWithAdapters(targetDocument, supportedAdapters),
  });
}
