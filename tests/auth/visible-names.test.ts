/**
 * A stored name must render at least one character a human can see.
 *
 * TWO SEPARATE DEFECTS, and only the second one actually mattered.
 *
 * 1. `.trim()` is not an emptiness test. It strips the ECMAScript WhiteSpace
 *    production — spaces, tabs, NBSP, and U+FEFF — but NOT the zero-width
 *    FORMAT characters, which are category Cf rather than Zs. So a lone U+200B
 *    passed `z.string().trim().min(1)`, satisfied every
 *    `first_name?.trim() ? …` guard in the app, and rendered as blank
 *    everywhere. That reopened the defect PR #21 fixed.
 *
 * 2. THE SCHEMA WAS NEVER ON THE WRITE PATH. Migration 0030 grants
 *    `update (first_name, last_name, …)` to `authenticated`, so a signed-in
 *    user can PATCH the column through PostgREST without running any
 *    application code. Fixing the Zod schema alone would have changed nothing
 *    for anyone who did not use the signup form.
 *
 * These tests therefore go straight at the database with a real authenticated
 * session — the same way the investigation found it — because that is the path
 * that has to be closed. The Zod tests below cover the UX half only.
 *
 * Same class as 0028/0030/0031/0041: application-layer validation on a column
 * the client is separately granted permission to write.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import { hasVisibleName, normalizeName, visibleName } from "@/lib/profile/name";
import { signUpSchema } from "@/lib/auth/schemas";

const ZWSP = "​";
const ZWNJ = "‌";
const ZWJ = "‍";
const WORD_JOINER = "⁠";
const MONGOLIAN = "᠎";
const BOM = "﻿";

let user: { id: string; client: DB };

beforeAll(async () => {
  user = await createAuthedTestUser("viznames");
}, 60_000);

afterAll(async () => {
  if (user) await deleteTestUsers([user.id]);
}, 60_000);

describe("the database refuses an invisible name (0045)", () => {
  /*
   * The assertion that matters. Against today's code every one of these
   * writes SUCCEEDS — confirmed against production during the investigation:
   *
   *   U+200B only        write=OK  stored_len=1  passes .trim().min(1)=true
   *   U+2060 word joiner write=OK  stored_len=1  passes .trim().min(1)=true
   *   plain space only   write=OK  stored_len=1  passes .trim().min(1)=false
   */
  const invisible: Array<[string, string]> = [
    ["U+200B zero width space", ZWSP],
    ["U+200C zero width non-joiner", ZWNJ],
    ["U+200D zero width joiner", ZWJ],
    ["U+2060 word joiner", WORD_JOINER],
    ["U+180E mongolian vowel separator", MONGOLIAN],
    ["U+FEFF byte order mark", BOM],
    ["a plain space", " "],
    ["mixed invisibles", `${ZWSP}${BOM} ${WORD_JOINER}`],
  ];

  for (const [label, value] of invisible) {
    it(`rejects a first_name of ${label}, written directly past the schema`, async () => {
      const { error } = await user.client
        .from("profiles")
        .update({ first_name: value })
        .eq("id", user.id);

      expect(
        error,
        `BLANK NAME STORED: ${label} was accepted and will render as nothing in the avatar, Farah's greeting and the Pass renewal email`,
      ).not.toBeNull();
      expect(error?.code, "should be a check-constraint violation").toBe("23514");

      const { data } = await admin
        .from("profiles")
        .select("first_name")
        .eq("id", user.id)
        .single();
      expect(data?.first_name, "nothing should have been written").not.toBe(value);
    });
  }

  it("rejects an invisible last_name too — both columns are constrained", async () => {
    const { error } = await user.client
      .from("profiles")
      .update({ last_name: ZWSP })
      .eq("id", user.id);
    expect(error?.code).toBe("23514");
  });
});

describe("what the constraint must NOT break", () => {
  it("allows NULL — the normal pre-onboarding state", async () => {
    /*
     * Load-bearing. Most profiles have no name yet; a constraint written as
     * `length(trim(first_name)) > 0` without a NULL branch would block the
     * next update to every one of them.
     */
    const { error } = await user.client
      .from("profiles")
      .update({ first_name: null, last_name: null })
      .eq("id", user.id);
    expect(error, "a profile with no name yet must remain writable").toBeNull();
  });

  it("allows a real name, including one padded or containing an invisible", async () => {
    for (const value of ["Ada", "  Ada  ", `Ada${ZWJ}Lovelace`, "Chinyere", "Ọlá"]) {
      const { error } = await user.client
        .from("profiles")
        .update({ first_name: value })
        .eq("id", user.id);
      expect(error, `"${value}" is a real name and must be accepted`).toBeNull();
    }
  });
});

describe("the JS helper agrees with the database", () => {
  /*
   * The rule is expressed twice — here and as a Postgres CHECK — because a
   * regex cannot be shared across them. Drift is its own bug, and it happened
   * once already: Postgres `\s` does not cover U+FEFF while JS `.trim()` does,
   * so before that was fixed the SQL side accepted a BOM-only name the JS side
   * rejected. This asserts the two agree on every case.
   */
  const cases: Array<[string, boolean]> = [
    [ZWSP, false], [ZWNJ, false], [ZWJ, false], [WORD_JOINER, false],
    [MONGOLIAN, false], [BOM, false], [" ", false], ["", false],
    [`${ZWSP}${BOM} `, false],
    ["Ada", true], ["  Ada  ", true], [`${ZWSP}Ada`, true], ["Ọlá", true],
  ];

  for (const [value, expected] of cases) {
    it(`JS and SQL agree that ${JSON.stringify(value)} is ${expected ? "visible" : "invisible"}`, async () => {
      expect(hasVisibleName(value), "JS helper").toBe(expected);

      const { data, error } = await admin.rpc("has_visible_characters", { value });
      if (error) throw error;
      expect(data, "Postgres has_visible_characters must agree with the JS helper").toBe(expected);
    });
  }
});

describe("the signup schema gives a readable error instead of a raw 23514", () => {
  /*
   * Generated, not a literal. A hardcoded `password: "..."` is a true positive
   * for this repo's own secret scanner (rule talentrah-hardcoded-credential) —
   * it caught this line on the first CI run of this branch, correctly this
   * time. Allowlisting would be the wrong fix: an entry saying "this one is
   * fine" is how the next real one gets waved through.
   *
   * Built to satisfy every rule in getPasswordRequirements (length >= 8, one
   * upper, one lower, one digit) without any of it being a guessable literal.
   */
  const validPassword = `Aa1${randomUUID()}`;
  const base = {
    email: "someone@example.com",
    country: "Nigeria",
    password: validPassword,
    termsAccepted: "on",
  };

  it("rejects a zero-width first name at the form", () => {
    const result = signUpSchema.safeParse({ ...base, firstName: ZWSP, lastName: "Okonkwo" });
    expect(result.success).toBe(false);
  });

  it("still accepts an ordinary name", () => {
    const result = signUpSchema.safeParse({ ...base, firstName: "Adaeze", lastName: "Okonkwo" });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });
});

describe("normalizeName", () => {
  it("removes invisibles and collapses the whitespace they were holding apart", () => {
    expect(normalizeName(`Ada${ZWSP}  ${ZWSP}Lovelace`)).toBe("Ada Lovelace");
    expect(visibleName(`  ${BOM}Ada  `)).toBe("Ada");
  });
});
