import { createStandardAtsAdapter } from "@copilot/ats-core";

export const comeetAdapter = createStandardAtsAdapter({
  id: "COMEET",
  slug: "comeet",
  hostPatterns: [/(^|\.)comeet\.co$/i],
  domSelectors: ["[data-ats='comeet']", "[data-comeet-job]", "[data-comeet-position]"],
  routeId(url) {
    return url.pathname.match(/\/jobs\/[^/]+\/[^/]+\/[^/]+\/([^/]+)/i)?.[1] ?? "";
  },
  titleSelectors: ["[data-job-title]", "[data-comeet-position-name]", "h1"],
  companySelectors: ["[data-company-name]", "[data-comeet-company-name]"],
  descriptionSelectors: [
    "[data-job-description]",
    "[data-comeet-position-description]",
    "[itemprop='description']",
  ],
  locationSelectors: [
    "[data-job-location]",
    "[data-comeet-position-location]",
    "[itemprop='jobLocation']",
  ],
});
