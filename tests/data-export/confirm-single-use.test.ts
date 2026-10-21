/**
 * What this file proves, and what it does not. It proves (1) the confirm page's form posts to the right place, /data-export/<id> by POST, read FROM the rendered page, and (2) the real handler turns a claim that
 * answers null into a 404, with no script involved. The in-memory store here is a double: the null on the second request comes from the double, so this file cannot catch a broken real claim.
 * The single-use guarantee itself is tested in tests/rls/data-export-files.test.ts (the real claim function, including parallel claims) and tests/data-export/download.test.ts (the real handler, database and bucket).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { randomUUID } from "node:crypto";
import { fake, seedExport } from "../support/data-export-fake-store";
import { handleDownload } from "@/lib/data-export/download";
import { renderConfirmPage } from "@/lib/data-export/pages";

vi.mock("@/lib/data-export/store", async () => (await import("../support/data-export-fake-store")).storeModule());
vi.mock("@/lib/data-export/audit", async () => (await import("../support/data-export-fake-store")).auditModule());

let info: MockInstance<(...args: unknown[]) => void>;
beforeEach(() => {
  fake.reset();
  info = vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => info.mockRestore());

const BASE = "https://www.example.test";
const as = (userId: string) => ({ service: {} as never, getUser: async () => ({ id: userId }) });

describe("the page posts to the right place and the real handler refuses a null claim", () => {
  it("the page's form posts to /data-export/<id>; sent twice with no script, the first gets the file and the second (the double answers null) is a 404", async () => {
    const owner = randomUUID();
    const row = seedExport({ user_id: owner });
    const html = renderConfirmPage({ id: row.id, expiresText: "2026-10-22 09:30 UTC" });
    const form = /<form id="dl" method="(\w+)" action="([^"]+)">/.exec(html);
    expect(form, "the confirm page has its form").not.toBeNull();
    const [, method, action] = form!;
    expect(method.toUpperCase()).toBe("POST");
    expect(action).toBe(`/data-export/${row.id}`);

    const send = () => handleDownload(new Request(`${BASE}${action}`, { method: method.toUpperCase(), headers: { Origin: BASE } }), row.id, as(owner));
    const first = await send();
    const second = await send();
    expect([first.status, second.status]).toEqual([200, 404]);
    await first.text();
    expect(fake.rows.get(row.id)!.status).toBe("deleted");
  });
});
