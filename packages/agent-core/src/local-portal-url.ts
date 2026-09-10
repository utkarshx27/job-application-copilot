// Exact research routes. This does not grant the production scanner any new access.
export function isPreparationExecutionUrl(url: string): boolean {
  return /^http:\/\/127\.0\.0\.1:4173\/portal\.html\?scenario=portal-(?:01|02|30|31|32|33|34)&jobId=job-\d+-\d+$/.test(
    url,
  );
}
export function preparationWorkflowUrl(url: string): string {
  if (!isPreparationExecutionUrl(url)) throw new Error("Unsupported local preparation route.");
  return url.split("&jobId=")[0]!;
}
