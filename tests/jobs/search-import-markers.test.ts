/** The search RPC's rows carry no import marker; withImportMarkers adds it, so an imported posting in search results is still link-out. */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { withImportMarkers } from "@/lib/jobs/import-markers";

const FEED = "11111111-1111-4111-8111-111111111111";
const client = (data: unknown, error: { message: string } | null = null) => ({ from: () => ({ select: () => ({ in: async () => ({ data, error }) }) }) });

describe("withImportMarkers", () => {
  it("marks the imported row and leaves the others null", async () => {
    const out = await withImportMarkers(client([{ id: "a", import_feed_id: FEED }, { id: "b", import_feed_id: null }]), [{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(out.map((r) => [r.id, r.import_feed_id])).toEqual([["a", FEED], ["b", null], ["c", null]]);
  });
  it("makes no query for no rows", async () => {
    expect(await withImportMarkers({ from: () => { throw new Error("must not query"); } }, [])).toEqual([]);
  });
  it("a failed read leaves the rows unmarked and logs, instead of failing the page", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await withImportMarkers(client(null, { message: "boom" }), [{ id: "a" }]);
    expect(out).toEqual([{ id: "a", import_feed_id: null }]);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
  it("keeps every other field of the row", async () => {
    const out = await withImportMarkers(client([{ id: "a", import_feed_id: FEED }]), [{ id: "a", title: "T", rank: 0.4 }]);
    expect(out[0]).toMatchObject({ id: "a", title: "T", rank: 0.4, import_feed_id: FEED });
  });
});
