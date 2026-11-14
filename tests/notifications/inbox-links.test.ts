/** A notification's link is rendered only when it is a same-origin PATH. Anything else is dropped (the item still shows, without a link). */
import { describe, expect, it } from "vitest";
import { safeInternalPath } from "@/lib/notifications/inbox/links";

describe("safeInternalPath", () => {
  it.each(["/jobs", "/jobs/abc-123?tab=saved#top", "/tracker/xyz/sent", "/billing"])("keeps %s", (link) => expect(safeInternalPath(link)).toBe(link));
  it.each([
    "https://evil.example/x",
    "http://evil.example",
    "//evil.example/x",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "data:text/html,x",
    "mailto:a@b.test",
    "jobs/relative",
    " /jobs",
    "/jobs\n",
    "/jo\u0000bs",
    "",
    "/",
  ])("drops %j", (link) => expect(safeInternalPath(link)).toBeNull());
  it("drops a missing, non-string or very long link", () => {
    for (const bad of [null, undefined, 42, {}, "/" + "a".repeat(600)]) expect(safeInternalPath(bad)).toBeNull();
  });
});
