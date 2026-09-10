/**
 * pending-job-banner.ts — the sessionStorage-backed handoff that carries a
 * cropped-but-not-yet-uploaded banner from the create form across
 * postJobAction's redirect to the post-success card (send-134).
 *
 * WHAT THIS COVERS AND WHAT IT DOESN'T. `parseOwnedPendingBanner` is the one
 * piece of this file with no browser API in it, pulled out specifically so
 * the security-relevant part — a staged banner must never be usable by a
 * different signed-in user than the one who staged it — is testable without
 * a real `sessionStorage`. `storePendingJobBanner`/`clearPendingJobBanner`/
 * `takePendingJobBanner` are thin glue over `sessionStorage`, `FileReader`
 * and `fetch` on a data: URL; this project has no jsdom to fake those (see
 * banner-crop.test.ts's own header for the same reasoning applied to
 * `renderCroppedBanner`), so they are exercised by the real browser in
 * e2e/employer-new-job-banner.spec.ts instead.
 */
import { describe, expect, it } from "vitest";
import { parseOwnedPendingBanner } from "@/lib/employer/pending-job-banner";

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";
const DATA_URL = "data:image/png;base64,aGVsbG8=";

describe("parseOwnedPendingBanner", () => {
  it("returns null when there is nothing staged", () => {
    expect(parseOwnedPendingBanner(null, USER_A)).toBeNull();
    expect(parseOwnedPendingBanner("", USER_A)).toBeNull();
  });

  it("returns the payload when it belongs to the current user", () => {
    const raw = JSON.stringify({ userId: USER_A, dataUrl: DATA_URL });
    expect(parseOwnedPendingBanner(raw, USER_A)).toEqual({ userId: USER_A, dataUrl: DATA_URL });
  });

  /*
   * THE CASE THIS FUNCTION EXISTS FOR. A different signed-in user in the
   * same tab (a shared machine, or a browser feature that copies
   * sessionStorage into a new tab) must never have someone else's staged
   * artwork silently attached to their own job.
   */
  it("returns null when the staged payload belongs to a different user", () => {
    const raw = JSON.stringify({ userId: USER_B, dataUrl: DATA_URL });
    expect(parseOwnedPendingBanner(raw, USER_A)).toBeNull();
  });

  it("returns null on malformed JSON rather than throwing", () => {
    expect(parseOwnedPendingBanner("{not json", USER_A)).toBeNull();
  });

  it("returns null when the shape is wrong", () => {
    expect(parseOwnedPendingBanner(JSON.stringify({}), USER_A)).toBeNull();
    expect(parseOwnedPendingBanner(JSON.stringify({ userId: USER_A }), USER_A)).toBeNull();
    expect(parseOwnedPendingBanner(JSON.stringify({ dataUrl: DATA_URL }), USER_A)).toBeNull();
    expect(
      parseOwnedPendingBanner(JSON.stringify({ userId: 42, dataUrl: DATA_URL }), USER_A),
    ).toBeNull();
  });

  it("returns null for an empty-string userId or dataUrl", () => {
    expect(parseOwnedPendingBanner(JSON.stringify({ userId: "", dataUrl: DATA_URL }), USER_A)).toBeNull();
    expect(parseOwnedPendingBanner(JSON.stringify({ userId: USER_A, dataUrl: "" }), USER_A)).toBeNull();
  });
});
