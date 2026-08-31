import { createStandardAtsAdapter } from "@copilot/ats-core";

export const workableAdapter = createStandardAtsAdapter({
  id: "WORKABLE",
  slug: "workable",
  hostPatterns: [/(^|\.)apply\.workable\.com$/i],
  domSelectors: ["[data-ats='workable']", "[data-workable-job]", "[data-ui='job']"],
  routeId(url) {
    return (
      url.pathname.match(/\/j\/([^/]+)/i)?.[1] ??
      url.pathname.split("/").filter(Boolean).at(-1) ??
      ""
    );
  },
  titleSelectors: ["[data-job-title]", "[data-ui='job-title']", "h1"],
  companySelectors: ["[data-company-name]", "[data-ui='company-name']"],
  descriptionSelectors: [
    "[data-job-description]",
    "[data-ui='job-description']",
    "[itemprop='description']",
  ],
  locationSelectors: [
    "[data-job-location]",
    "[data-ui='job-location']",
    "[itemprop='jobLocation']",
  ],
});
