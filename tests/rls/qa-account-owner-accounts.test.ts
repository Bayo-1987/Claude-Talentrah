/**
 * public.is_qa_account after 0251: the owner's stonebridgehibr1+<tag>@gmail.com accounts are QA accounts; nobody else became one. Database-backed (CI only: the local stack applies every migration).
 * The function is service_role only, so it is called through the service-role client.
 */
import { describe, expect, it } from "vitest";
import { admin } from "../support/auth";

async function isQa(email: string | null, first: string | null = null, last: string | null = null, display: string | null = null): Promise<boolean> {
  // The function is service_role only and is not in the generated types, so it is called untyped, as tests/rls/qa-account-exclusion.test.ts does.
  const { data, error } = await admin.rpc("is_qa_account" as never, { p_email: email, p_first: first, p_last: last, p_display: display } as never);
  if (error) throw new Error(`is_qa_account: ${error.message}`);
  return data as unknown as boolean;
}

describe("0251: the owner's plus-addresses", () => {
  it.each([
    "stonebridgehibr1+test@gmail.com",
    "stonebridgehibr1+a.b_c-d9@gmail.com",
    "StoneBridgeHibr1+Amara@GMAIL.COM",
    "  stonebridgehibr1+x@gmail.com  ",
  ])("%s is a QA account", async (email) => {
    expect(await isQa(email)).toBe(true);
  });
  it.each([
    "stonebridgehibr1@gmail.com",
    "stonebridgehibr1+@gmail.com",
    "stonebridgehibr12+x@gmail.com",
    "xstonebridgehibr1+x@gmail.com",
    "stonebridge.hibr1+x@gmail.com",
    "stonebridgehibr1+x@googlemail.com",
    "stonebridgehibr1+x@gmail.co",
    "stonebridgehibr1+x@gmail.com.evil.test",
    "stonebridgehibr1+x@evilgmail.com",
    "stonebridgehibr1+x@y@gmail.com",
    "stonebridgehibr1+x y@gmail.com",
  ])("%s is NOT a QA account", async (email) => {
    expect(await isQa(email)).toBe(false);
  });
  it("the name Amara Test on its own is not a QA account", async () => {
    expect(await isQa("someone@example.com", "Amara", "Test")).toBe(false);
  });
});

describe("0251: the 0240 rule is unchanged", () => {
  it("+qa- in the email, any case; names exactly QA or starting with 'QA '; not Qasim, Qa Hoang or QAnon; null-safe", async () => {
    expect(await isQa("hello+qa-seeker@talentrah.com")).toBe(true);
    expect(await isQa("hello+QA-Employer@talentrah.com")).toBe(true);
    expect(await isQa("real@example.com", "QA", "Seeker")).toBe(true);
    expect(await isQa("real@example.com", null, null, "QA Mentor")).toBe(true);
    expect(await isQa("real@example.com", "Qasim")).toBe(false);
    expect(await isQa("real@example.com", "Qa", "Hoang")).toBe(false);
    expect(await isQa("real@example.com", "QAnon")).toBe(false);
    expect(await isQa(null)).toBe(false);
  });
});
