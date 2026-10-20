/**
 * The "How the requester was checked" pick-list on the admin data-export panel. `contact_form` is the first of the check keys (REQUESTER_CHECKS in src/lib/data-export/constants.ts). The contact form
 * records no account, so its label must not claim the sender was "signed in": that would say more than was checked. It reads "Asked through the contact form (sender not verified)". The earlier labels
 * ("Asked through the signed-in contact form", then "...while signed in to this account") both over-claimed. This pins the wording, that it never contains "signed", and that the option VALUES
 * (the keys written to the audit log) are the fixed list.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DataExportPanel } from "@/components/admin/data-export-panel";
import { REQUESTER_CHECKS } from "@/lib/data-export/constants";

const html = renderToStaticMarkup(<DataExportPanel personId="00000000-0000-4000-8000-000000000001" />);
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

/** The requester-check <select> only (not the reason one): its options as [value, visible text]. */
function checkOptions(): Array<[string, string]> {
  const select = /<select[^>]*name="requesterCheck"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  expect(select, "the requester-check select is on the panel").not.toBeNull();
  return [...select![1].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)].map((m) => [m[1], decode(m[2])]);
}

describe("the requester-check pick-list", () => {
  it("the contact_form option says the request came through the contact form and that the sender was not verified", () => {
    const label = checkOptions().find(([value]) => value === "contact_form")?.[1];
    expect(label).toBe("Asked through the contact form (sender not verified)");
    expect(label?.toLowerCase(), "the form records no account, so the label must not say signed in").not.toContain("signed");
  });

  it("the option values are exactly the check keys, unchanged (the label is the only thing that varies)", () => {
    const values = checkOptions().map(([value]) => value).filter((v) => v !== "");
    expect(values).toEqual([...REQUESTER_CHECKS]);
    expect([...REQUESTER_CHECKS]).toEqual(["contact_form", "registered_address_reply"]);
  });
});
