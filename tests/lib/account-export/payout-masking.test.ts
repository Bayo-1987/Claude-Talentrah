/**
 * The owner's decision 1 (6 Oct 2026): a mentor's payout data appears in the export ONLY as the bank name and the last four digits of the account number,
 * with a line in the README that says full details are available on a verified request to support. A full account number, the account holder's name or the
 * transfer recipient code ANYWHERE in the file fails these tests, whatever key it sits under.
 */
import { describe, expect, it } from "vitest";
import { BANK_DETAILS_LINE } from "@/lib/account-export/readme";
import { maskBankDetails } from "@/lib/account-export/shape";
import { MENTOR, MENTEE, HIDDEN_ACCOUNT_NAME, HIDDEN_ACCOUNT_NUMBER, HIDDEN_RECIPIENT_CODE, HIDDEN_TRANSFER_CODE } from "../../support/export-fixtures";
import { runExport } from "../../support/run-export";

describe("a mentor's payout details in the export", () => {
  it("appear as the bank name and the last four digits, and nothing more", async () => {
    const { file } = await runExport(MENTOR);
    const [profile] = file.tables.mentor_profiles;
    expect(profile.payout_bank_name).toBe("Access Bank");
    expect(profile.payout_account_last_four).toBe("6789");
    expect(Object.keys(profile).filter((k) => k.startsWith("payout_")).sort()).toEqual(["payout_account_last_four", "payout_bank_name", "payout_bank_verified_at"]);
  });

  it("never include the full account number, the holder's name, the recipient code or a transfer reference, under any key", async () => {
    const { text } = await runExport(MENTOR);
    for (const secret of [HIDDEN_ACCOUNT_NUMBER, HIDDEN_ACCOUNT_NAME, HIDDEN_RECIPIENT_CODE, HIDDEN_TRANSFER_CODE, "pending_ref_zz"]) {
      expect(text, `the file contains ${secret}`).not.toContain(secret);
    }
    expect(text).not.toContain("payout_recipient_code");
    expect(text).not.toContain("payout_account_number");
    expect(text).not.toMatch(/\b0123\d{6}\b/);
  });

  it("the README carries the line about full details on a verified request to support", async () => {
    const { file } = await runExport(MENTOR);
    expect(file._readme).toContain(BANK_DETAILS_LINE);
    expect(BANK_DETAILS_LINE).toMatch(/last four digits/);
    expect(BANK_DETAILS_LINE).toMatch(/verified request to support/);
  });

  it("when the bank's name cannot be looked up, the public bank code is shown instead of an empty line, still without the account number", async () => {
    const { file, text } = await runExport(MENTOR, { bankNames: "fail" });
    const [profile] = file.tables.mentor_profiles;
    expect(profile.payout_bank_name).toBeNull();
    expect(profile.payout_bank_code).toBe("058");
    expect(profile.payout_account_last_four).toBe("6789");
    expect(text).not.toContain(HIDDEN_ACCOUNT_NUMBER);
  });

  it("a mentee's file has no payout columns at all", async () => {
    const { text } = await runExport(MENTEE);
    expect(text).not.toContain("payout_");
  });

  it("the masking rule is one function: four digits of a longer number, null for anything shorter or not a string", () => {
    expect(maskBankDetails("0123456789")).toBe("6789");
    expect(maskBankDetails("0123 456 789")).toBe("6789");
    expect(maskBankDetails("123")).toBeNull();
    expect(maskBankDetails(null)).toBeNull();
    expect(maskBankDetails(1234567890)).toBeNull();
  });
});
