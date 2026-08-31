import { createStandardAtsAdapter } from "@copilot/ats-core";

export const taleoAdapter = createStandardAtsAdapter({
  id: "TALEO",
  slug: "taleo",
  hostPatterns: [/(^|\.)taleo\.net$/i],
  domSelectors: ["[data-ats='taleo']", "[data-taleo-job]", "#requisitionDescriptionInterface"],
  routeId(url) {
    return url.searchParams.get("job") ?? "";
  },
  titleSelectors: ["[data-job-title]", ".titlepage", "h1"],
  companySelectors: ["[data-company-name]", ".company-name"],
  descriptionSelectors: [
    "[data-job-description]",
    "#requisitionDescriptionInterface",
    "[itemprop='description']",
  ],
  locationSelectors: ["[data-job-location]", ".joblocation", "[itemprop='jobLocation']"],
});
