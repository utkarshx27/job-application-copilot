import { createStandardAtsAdapter } from "@copilot/ats-core";

export const jobviteAdapter = createStandardAtsAdapter({
  id: "JOBVITE",
  slug: "jobvite",
  hostPatterns: [/(^|\.)(jobs|careers)\.jobvite\.com$/i],
  domSelectors: ["[data-ats='jobvite']", "[data-jobvite-job]", ".jv-job-detail"],
  routeId(url) {
    return url.pathname.match(/\/job\/([^/]+)/i)?.[1] ?? "";
  },
  titleSelectors: ["[data-job-title]", ".jv-header h1", "h1"],
  companySelectors: ["[data-company-name]", ".jv-company-name"],
  descriptionSelectors: [
    "[data-job-description]",
    ".jv-job-detail-description",
    "[itemprop='description']",
  ],
  locationSelectors: ["[data-job-location]", ".jv-job-detail-location", "[itemprop='jobLocation']"],
});
