/**
 * Single use belongs to the SERVER. The confirm page's script only disables the button and shows a line; with scripts off a double click can send two POSTs, and the answer to the second is still a
 * refusal because the claim is one conditional update. This file takes the form's method and action FROM the rendered page and sends them twice to the real handler with no script involved.
 * In-memory store, no database (the real claim function is held by tests/data-export/download.test.ts and tests/rls/data-export-files.test.ts).
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

describe("the form's single use is the server's claim, not the script", () => {
  it("the page's form posts to /data-export/<id>, and sending that POST twice (the script never ran) gives the file once and a refusal the second time", async () => {
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
