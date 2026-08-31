import { createStandardAtsAdapter } from "@copilot/ats-core";

export const icimsAdapter = createStandardAtsAdapter({
  id: "ICIMS",
  slug: "icims",
  hostPatterns: [/(^|\.)icims\.com$/i],
  domSelectors: ["[data-ats='icims']", "[data-icims-job]", ".iCIMS_JobHeader"],
  routeId(url) {
    return url.pathname.match(/\/jobs\/(\d+)/i)?.[1] ?? "";
  },
  titleSelectors: ["[data-job-title]", ".iCIMS_Header h1", "h1"],
  companySelectors: ["[data-company-name]", ".iCIMS_CompanyName"],
  descriptionSelectors: ["[data-job-description]", ".iCIMS_JobContent", "[itemprop='description']"],
  locationSelectors: ["[data-job-location]", ".iCIMS_JobHeaderField", "[itemprop='jobLocation']"],
});
