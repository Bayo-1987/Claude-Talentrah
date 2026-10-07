/**
 * The mentor application and profile-update actions refuse an incomplete form on the SERVER (S1-93).
 *
 * Found in a live check: pressing the button with every field empty answered "Application submitted", because both actions turned every blank into null
 * and the database allows null for every column. So the rules live in the actions, not only in the form:
 *
 *   required   display name (trimmed, non-empty), bio (at least 80 characters of text), at least one role, years of experience (a whole number, 0 to 60)
 *   optional   industries, and the price: blank means free or volunteer, but a price that is given must be a positive whole number of Naira
 *
 * The Supabase client is a recorder: what these tests prove is which writes the action does and does not make. The database-backed suites next to this one
 * (mentor-profile-display-name-action.test.ts) cover the same actions against real RLS.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const world = vi.hoisted(() => ({ writes: [] as Array<{ op: "insert" | "update"; row: Record<string, unknown> }>, nameWarning: null as string | null }));

vi.mock("@/lib/auth/require-user", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth/require-user")>()), requireUser: async () => ({ user: { id: "user-1" } }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table !== "mentor_profiles") throw new Error(`unexpected table ${table}`);
      return {
        insert: async (row: Record<string, unknown>) => {
          world.writes.push({ op: "insert", row });
          return { error: null };
        },
        update: (row: Record<string, unknown>) => ({
          eq: async () => {
            world.writes.push({ op: "update", row });
            return { error: null };
          },
        }),
      };
    },
  }),
}));
vi.mock("@/lib/mentorship/name-validation", () => ({ warnIfNameLooksLikeOwnOrg: async () => world.nameWarning }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/paystack/client", () => ({ initializeTransaction: async () => ({}), NGN_CHANNELS: [] }));
vi.mock("@/lib/mentorship/meeting-link", () => ({ generateMeetingLink: () => "" }));
vi.mock("@/lib/mentorship/notifications", () => ({ notifySessionConfirmed: async () => {} }));
vi.mock("@/lib/analytics/posthog", () => ({ captureEvent: () => {} }));
vi.mock("@/lib/mentorship/unpaid-hold", () => ({ unpaidHoldLapsed: () => false }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { applyToBecomeMentorAction, updateMentorProfileAction } from "@/lib/mentorship/actions";
import { initialFormValues } from "@/app/(app)/mentorship/apply/application-form";
import type { OwnMentorProfile } from "@/lib/mentorship/queries";

const BIO = "I have spent eight years shipping payments products across Lagos and London, and I enjoy helping people prepare for product interviews.";
const valid = {
  displayName: "Nkem Adeyemi",
  bio: BIO,
  expertiseRoles: "Product Manager, Software Engineer",
  expertiseIndustries: "Fintech, Healthcare",
  yearsExperience: "8",
  basePriceNgn: "15000",
};

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
const without = (key: keyof typeof valid) => {
  const { [key]: _omitted, ...rest } = valid;
  void _omitted;
  return rest;
};
const emptyForm = { displayName: "", bio: "", expertiseRoles: "", expertiseIndustries: "", yearsExperience: "", basePriceNgn: "" };

const ACTIONS = [
  ["applyToBecomeMentorAction", applyToBecomeMentorAction, "insert"],
  ["updateMentorProfileAction", updateMentorProfileAction, "update"],
] as const;

type Result = { status: string; message: string; fieldErrors?: Record<string, string> };
const run = async (action: (p: unknown, f: FormData) => Promise<unknown>, fields: Record<string, string>) => (await action(null, form(fields))) as Result;

beforeEach(() => {
  world.writes.length = 0;
  world.nameWarning = null;
});

describe.each(ACTIONS)("%s", (_name, action, op) => {
  it("an EMPTY submit is rejected and writes nothing (it used to answer 'Application submitted')", async () => {
    const result = await run(action, emptyForm);
    expect(result.status).toBe("error");
    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["bio", "displayName", "expertiseRoles", "yearsExperience"]);
    expect(world.writes, "a blank row was written").toEqual([]);
  });

  it("a form with no fields at all is rejected too", async () => {
    const result = await run(action, {});
    expect(result.status).toBe("error");
    expect(world.writes).toEqual([]);
  });

  it.each([
    ["displayName", /name/i],
    ["bio", /bio/i],
    ["expertiseRoles", /role/i],
    ["yearsExperience", /years/i],
  ] as const)("a missing %s is rejected, with an error that says what is missing, and nothing is written", async (key, words) => {
    const result = await run(action, without(key));
    expect(result.status).toBe("error");
    expect(Object.keys(result.fieldErrors ?? {})).toEqual([key]);
    expect(result.fieldErrors![key]).toMatch(words);
    expect(world.writes).toEqual([]);
  });

  it("a display name of only spaces counts as missing", async () => {
    const result = await run(action, { ...valid, displayName: "   " });
    expect(Object.keys(result.fieldErrors ?? {})).toEqual(["displayName"]);
    expect(world.writes).toEqual([]);
  });

  it("a roles field of only commas and spaces counts as missing", async () => {
    const result = await run(action, { ...valid, expertiseRoles: " , ,, " });
    expect(Object.keys(result.fieldErrors ?? {})).toEqual(["expertiseRoles"]);
  });

  it("the bio needs 80 characters of TEXT: 79 is refused, 80 is accepted, and formatting marks do not count", async () => {
    const eighty = "a".repeat(80);
    expect(Object.keys((await run(action, { ...valid, bio: "a".repeat(79) })).fieldErrors ?? {})).toEqual(["bio"]);
    expect((await run(action, { ...valid, bio: eighty })).status).toBe("success");
    world.writes.length = 0;
    // 79 letters wrapped in bold is still 79 characters of text.
    expect(Object.keys((await run(action, { ...valid, bio: `**${"a".repeat(79)}**` })).fieldErrors ?? {})).toEqual(["bio"]);
    // Eighty asterisks and spaces are no text at all.
    expect(Object.keys((await run(action, { ...valid, bio: "** ".repeat(40) })).fieldErrors ?? {})).toEqual(["bio"]);
    expect(world.writes).toEqual([]);
  });

  it.each([
    ["abc"],
    ["-1"],
    ["61"],
    ["1.5"],
    ["1e1"],
    [" "],
  ])("years of experience %j is refused", async (years) => {
    const result = await run(action, { ...valid, yearsExperience: years });
    expect(Object.keys(result.fieldErrors ?? {})).toEqual(["yearsExperience"]);
    expect(world.writes).toEqual([]);
  });

  it.each([["0", 0], ["60", 60], [" 7 ", 7]])("years of experience %j is accepted and stored as %i", async (years, stored) => {
    const result = await run(action, { ...valid, yearsExperience: years });
    expect(result.status).toBe("success");
    expect(world.writes[0].row.years_experience).toBe(stored);
  });

  it.each([["0"], ["-5"], ["12.5"], ["abc"], ["5,000"], ["99999999999"]])("a price of %j is refused (given, it must be a positive whole number)", async (price) => {
    const result = await run(action, { ...valid, basePriceNgn: price });
    expect(Object.keys(result.fieldErrors ?? {})).toEqual(["basePriceNgn"]);
    expect(result.fieldErrors!.basePriceNgn).toMatch(/whole number/i);
    expect(world.writes).toEqual([]);
  });

  it("a blank price means free or volunteer and is accepted (stored as null)", async () => {
    const result = await run(action, { ...valid, basePriceNgn: "" });
    expect(result.status).toBe("success");
    expect(world.writes[0].row.base_price_ngn).toBeNull();
  });

  it("several problems are all reported at once", async () => {
    const result = await run(action, { ...valid, displayName: "", yearsExperience: "99", basePriceNgn: "-1" });
    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["basePriceNgn", "displayName", "yearsExperience"]);
  });

  it("a VALID submit is accepted and writes the cleaned values once", async () => {
    const result = await run(action, { ...valid, displayName: "  Nkem Adeyemi  ", expertiseRoles: "Product Manager,  Software Engineer ,", bio: `  ${BIO}  ` });
    expect(result.status).toBe("success");
    expect(world.writes).toHaveLength(1);
    expect(world.writes[0].op).toBe(op);
    expect(world.writes[0].row).toMatchObject({
      display_name: "Nkem Adeyemi",
      bio: BIO,
      expertise_roles: ["Product Manager", "Software Engineer"],
      expertise_industries: ["Fintech", "Healthcare"],
      years_experience: 8,
      base_price_ngn: 15000,
    });
  });

  it("the org-name warning still comes back as a warning, after the write", async () => {
    world.nameWarning = "That looks like your company's name.";
    const result = await run(action, valid);
    expect(result.status).toBe("warning");
    expect(result.message).toContain("company's name");
    expect(world.writes).toHaveLength(1);
  });
});

describe("applyToBecomeMentorAction", () => {
  it("says 'Application submitted' only for a valid application", async () => {
    expect((await run(applyToBecomeMentorAction, valid)).message).toMatch(/Application submitted/);
    expect((await run(applyToBecomeMentorAction, emptyForm)).message).not.toMatch(/submitted/i);
  });

  it("inserts the owner's own row, pending by default (no status is written by the action)", async () => {
    await run(applyToBecomeMentorAction, valid);
    expect(world.writes[0].row.user_id).toBe("user-1");
    expect(world.writes[0].row).not.toHaveProperty("status");
  });
});

describe("updateMentorProfileAction never writes blanks over saved values", () => {
  it("an update with the saved values unchanged keeps them: the payload carries the same values, none blank", async () => {
    await run(updateMentorProfileAction, valid);
    const row = world.writes[0].row;
    expect(row.display_name).toBe("Nkem Adeyemi");
    expect(row.bio).toBe(BIO);
    expect(row.expertise_roles).toEqual(["Product Manager", "Software Engineer"]);
    expect(row.years_experience).toBe(8);
    expect(Object.values(row).filter((v) => v === "" || v === null || (Array.isArray(v) && v.length === 0))).toEqual([]);
  });

  it("an empty update does not reach the database at all", async () => {
    await run(updateMentorProfileAction, emptyForm);
    expect(world.writes).toEqual([]);
  });

  it("a field left out of the form entirely is left out of the update, never written as a blank", async () => {
    await run(updateMentorProfileAction, without("expertiseIndustries"));
    expect(world.writes[0].row).not.toHaveProperty("expertise_industries");
    world.writes.length = 0;
    await run(updateMentorProfileAction, without("basePriceNgn"));
    expect(world.writes[0].row).not.toHaveProperty("base_price_ngn");
  });
});

describe("an existing mentor whose saved profile no longer meets the rule is told plainly, in the words of saving", () => {
  const SHORT_BIO = "Product manager in Lagos, happy to help.";

  it("a short bio on an edit: 'Your bio needs at least 80 characters before you can save changes.'", async () => {
    const result = await run(updateMentorProfileAction, { ...valid, bio: SHORT_BIO });
    expect(result.status).toBe("error");
    expect(result.fieldErrors!.bio).toContain("Your bio needs at least 80 characters before you can save changes.");
    expect(world.writes).toEqual([]);
  });

  it("the same short bio when APPLYING is about submitting, not saving", async () => {
    const result = await run(applyToBecomeMentorAction, { ...valid, bio: SHORT_BIO });
    expect(result.fieldErrors!.bio).toMatch(/at least 80/);
    expect(result.fieldErrors!.bio).not.toMatch(/save changes/i);
  });

  it("an empty bio on an edit says the same sentence (a saved profile with no bio is the same case)", async () => {
    const result = await run(updateMentorProfileAction, { ...valid, bio: "" });
    expect(result.fieldErrors!.bio).toContain("Your bio needs at least 80 characters before you can save changes.");
  });

  it("missing years on an edit (a profile saved before years were required) says what to add and that it blocks saving", async () => {
    const result = await run(updateMentorProfileAction, { ...valid, yearsExperience: "" });
    expect(result.fieldErrors!.yearsExperience).toMatch(/years of experience/i);
    expect(result.fieldErrors!.yearsExperience).toMatch(/before you can save changes/i);
    expect(world.writes).toEqual([]);
  });

  it("every other required field on an edit uses the same ending", async () => {
    const result = await run(updateMentorProfileAction, emptyForm);
    for (const message of Object.values(result.fieldErrors!)) expect(message).toMatch(/before you can save changes/i);
    expect(result.message).toMatch(/not saved/i);
  });

  it("applying with an empty form still says the application was not submitted", async () => {
    const result = await run(applyToBecomeMentorAction, emptyForm);
    expect(result.message).not.toMatch(/saved/i);
    for (const message of Object.values(result.fieldErrors!)) expect(message).not.toMatch(/save changes/i);
  });
});

describe("clearing and keeping fields on an edit", () => {
  const SAVED: OwnMentorProfile = {
    status: "approved",
    displayName: "Nkem Adeyemi",
    bio: BIO,
    expertiseRoles: ["Product Manager", "Software Engineer"],
    expertiseIndustries: ["Fintech", "Healthcare"],
    yearsExperience: 8,
    basePriceNgn: 15000,
    reviewNote: null,
    reviewsVerifications: false,
    selfPaused: false,
  };
  const submittedFrom = (profile: OwnMentorProfile, override: Record<string, string> = {}) => {
    const fields = { ...initialFormValues(profile, undefined), ...override };
    return fields;
  };

  it("deliberately clearing the industries saves an EMPTY list (the field was in the form, submitted blank)", async () => {
    await run(updateMentorProfileAction, submittedFrom(SAVED, { expertiseIndustries: "" }));
    expect(world.writes[0].row.expertise_industries).toEqual([]);
  });

  it("deliberately clearing the price saves null (free or volunteer)", async () => {
    await run(updateMentorProfileAction, submittedFrom(SAVED, { basePriceNgn: "" }));
    expect(world.writes[0].row.base_price_ngn).toBeNull();
  });

  it("untouched fields keep their saved values: the form's own starting values, submitted as they are, write exactly what was saved", async () => {
    await run(updateMentorProfileAction, submittedFrom(SAVED));
    expect(world.writes[0].row).toEqual({
      display_name: "Nkem Adeyemi",
      bio: BIO,
      expertise_roles: ["Product Manager", "Software Engineer"],
      years_experience: 8,
      expertise_industries: ["Fintech", "Healthcare"],
      base_price_ngn: 15000,
    });
  });

  it("changing only one field leaves every other field at its saved value", async () => {
    await run(updateMentorProfileAction, submittedFrom(SAVED, { yearsExperience: "9" }));
    expect(world.writes[0].row).toMatchObject({ years_experience: 9, display_name: "Nkem Adeyemi", bio: BIO, expertise_industries: ["Fintech", "Healthcare"], base_price_ngn: 15000 });
  });

  it("a profile saved with no industries and no price starts the form blank in those two fields, and saves them as empty and null, never the text 'null'", async () => {
    const bare = { ...SAVED, expertiseIndustries: [], basePriceNgn: null };
    expect(initialFormValues(bare, undefined)).toMatchObject({ expertiseIndustries: "", basePriceNgn: "" });
    await run(updateMentorProfileAction, submittedFrom(bare));
    expect(world.writes[0].row).toMatchObject({ expertise_industries: [], base_price_ngn: null });
  });
});
