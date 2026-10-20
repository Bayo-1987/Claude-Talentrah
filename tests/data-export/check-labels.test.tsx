/**
 * The "How the requester was checked" pick-list on the admin data-export panel. `contact_form` is the check keys' first value (REQUESTER_CHECKS in src/lib/data-export/constants.ts: "the signed-in
 * contact form where possible"). Its label used to read "Asked through the signed-in contact form", which does not say who asked, or what was counted as proof. It now says what the check is:
 * the person sent the request through the contact form while signed in to the account. This pins that wording and that the option VALUES (the keys written to the audit log) are the fixed list.
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
  it("the contact_form option says the person sent the request through the contact form while signed in to the account", () => {
    const label = checkOptions().find(([value]) => value === "contact_form")?.[1];
    expect(label).toBe("They sent the request through the contact form while signed in to this account");
  });

  it("the option values are exactly the check keys, unchanged (the label is the only thing that varies)", () => {
    const values = checkOptions().map(([value]) => value).filter((v) => v !== "");
    expect(values).toEqual([...REQUESTER_CHECKS]);
    expect([...REQUESTER_CHECKS]).toEqual(["contact_form", "registered_address_reply"]);
  });
});
