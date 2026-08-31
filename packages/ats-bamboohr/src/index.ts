import { createStandardAtsAdapter } from "@copilot/ats-core";

export const bambooHrAdapter = createStandardAtsAdapter({
  id: "BAMBOOHR",
  slug: "bamboohr",
  hostPatterns: [/(^|\.)bamboohr\.com$/i],
  domSelectors: ["[data-ats='bamboohr']", "[data-bamboohr-job]", ".BambooHR-ATS-board"],
  routeId(url) {
    return url.pathname.match(/\/careers\/(\d+)/i)?.[1] ?? url.searchParams.get("jobId") ?? "";
  },
  titleSelectors: ["[data-job-title]", ".BambooHR-ATS-Job-Title", "h1"],
  companySelectors: ["[data-company-name]", ".BambooHR-ATS-company"],
  descriptionSelectors: [
    "[data-job-description]",
    ".BambooHR-ATS-Job-Description",
    "[itemprop='description']",
  ],
  locationSelectors: ["[data-job-location]", ".BambooHR-ATS-Location", "[itemprop='jobLocation']"],
});
