// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:4173/portal.html?scenario=portal-01&jobId=job-7-1"}
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { prepareNativeDocument } from "../src/job-preparation-document";
const input = {
  url: "http://127.0.0.1:4173/portal.html?scenario=portal-01&jobId=job-7-1",
  jobId: "job-7-1",
  action: "FILL_FIELDS" as const,
  answers: {
    name: "Priya Sharma",
    email: "priya@example.test",
    phone: "+919876543210",
    currentLocation: "Bengaluru",
    workArrangement: "Remote" as const,
  },
};
beforeEach(() => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  vi.stubGlobal("DOMRect", class {});
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
  document.body.innerHTML = `<section data-job-id="job-7-1" data-application-id="local">
    <label for="name">Full name</label><input id="name" name="name" required>
    <label for="email">Email</label><input id="email" name="email" type="email" required>
    <label for="phone">Phone number</label><input id="phone" name="phone" required>
    <label for="city">Current city</label><input id="city" name="currentLocation" required>
    <label for="arrangement">Work arrangement</label><select id="arrangement" name="workArrangement" required><option></option><option>Remote</option></select>
    <button>Next step</button></section>`;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("refuses unknown, hidden or sensitive extra questions before filling anything", async () => {
  document
    .querySelector("section")!
    .insertAdjacentHTML("beforeend", '<input type="hidden" name="consent">');
  await expect(prepareNativeDocument(input)).rejects.toThrow(/Unexpected/);
  expect(document.querySelector<HTMLInputElement>("#name")!.value).toBe("");
});
it("preserves user values and rejects mismatched labels, overlays and job identity", async () => {
  document.querySelector<HTMLInputElement>("#email")!.value = "user@example.test";
  await expect(prepareNativeDocument(input)).rejects.toThrow(/Existing page values/);
  expect(document.querySelector<HTMLInputElement>("#name")!.value).toBe("");
  document.querySelector<HTMLInputElement>("#email")!.value = "";
  document.querySelector('label[for="city"]')!.textContent = "Citizenship";
  await expect(prepareNativeDocument(input)).rejects.toThrow(/structure changed/);
  document.querySelector('label[for="city"]')!.textContent = "Current city";
  await expect(prepareNativeDocument(input)).rejects.toThrow(/overlay/);
  await expect(prepareNativeDocument({ ...input, jobId: "job-7-2" })).rejects.toThrow(
    /page changed/,
  );
});
it("stops on an access challenge or frame without interacting", async () => {
  document.body.insertAdjacentHTML("beforeend", '<p role="alert">Verification required</p>');
  await expect(prepareNativeDocument(input)).rejects.toThrow(/manual review/);
  document.querySelector('[role="alert"]')!.remove();
  document.body.insertAdjacentHTML("beforeend", "<iframe></iframe>");
  await expect(prepareNativeDocument(input)).rejects.toThrow(/Embedded forms/);
  expect(document.querySelector<HTMLInputElement>("#name")!.value).toBe("");
});
