/**
 * What /settings may and may not write, asserted at the database.
 *
 * The e2e drives the page; it cannot reach the cases that matter here. Every
 * one of these is a REFUSAL, and the UI has no way to attempt them — which is
 * the point: the action's `.select("id")` and row-count check exist for
 * failures a person cannot trigger by hand, and a test that only clicks
 * buttons proves nothing about them.
 *
 * THE WRITABLE SET IS THREE COLUMNS, and that is a decision made in 0030, not
 * a UI choice:
 *
 *   first_name, last_name, country   granted
 *   email                            revoked — the identity the account is
 *                                    keyed on
 *   market_segment                   revoked — a billing segment nobody
 *                                    self-selects
 *
 * If a future migration grants either of those back, this suite fails and the
 * settings form's shape has to be reconsidered on purpose rather than drifting.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";

let user: Awaited<ReturnType<typeof createAuthedTestUser>>;
let stranger: Awaited<ReturnType<typeof createAuthedTestUser>>;

const profileOf = async (id: string) => {
  const { data } = await admin
    .from("profiles")
    .select("first_name, last_name, country, email, market_segment")
    .eq("id", id)
    .single();
  return data!;
};

beforeAll(async () => {
  user = await createAuthedTestUser("settings-user");
  stranger = await createAuthedTestUser("settings-stranger");
});

afterAll(async () => {
  await deleteTestUsers([user.id, stranger.id]);
});

describe("the three fields the form offers", () => {
  it("save, and come back", async () => {
    const { data, error } = await user.client
      .from("profiles")
      .update({ first_name: "Ada", last_name: "Lovelace", country: "Nigeria" })
      .eq("id", user.id)
      .select("id");

    expect(error).toBeNull();
    // The row count is what the action checks — a refusal returns zero rows
    // with no error, which is indistinguishable from success without this.
    expect(data).toHaveLength(1);

    const p = await profileOf(user.id);
    expect(p.first_name).toBe("Ada");
    expect(p.country).toBe("Nigeria");
  });
});

describe("the two the form deliberately does not offer", () => {
  it("email is refused — it is the identity, not a profile field", async () => {
    const before = await profileOf(user.id);
    const { error } = await user.client
      .from("profiles")
      .update({ email: "someone-else@talentrah.test" })
      .eq("id", user.id);

    // A column-grant denial RAISES (42501). A row-policy denial would instead
    // return zero rows silently — telling those apart is the whole reason the
    // action checks both.
    expect(error).not.toBeNull();
    expect((await profileOf(user.id)).email).toBe(before.email);
  });

  it("market_segment is refused — nobody picks their own billing region", async () => {
    const before = await profileOf(user.id);
    const { error } = await user.client
      .from("profiles")
      .update({ market_segment: "diaspora" })
      .eq("id", user.id);
    expect(error).not.toBeNull();
    expect((await profileOf(user.id)).market_segment).toBe(before.market_segment);
  });
});

describe("someone else's profile", () => {
  it("matches zero rows rather than failing loudly — which is why the count is checked", async () => {
    await admin.from("profiles").update({ first_name: "Ada" }).eq("id", user.id);

    const { data, error } = await stranger.client
      .from("profiles")
      .update({ first_name: "Mallory" })
      .eq("id", user.id)
      .select("id");

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
    expect((await profileOf(user.id)).first_name).toBe("Ada");
  });
});

describe("a name with nothing visible in it", () => {
  it("is refused by the database, not only by the form", async () => {
    /*
     * 0045's CHECK constraint. The zod rule in settings-schemas.ts is the UX
     * half — 0030 grants update(first_name) to `authenticated`, so a client
     * can PATCH the column and never reach that file. This is the actual gate.
     */
    const { error } = await user.client
      .from("profiles")
      .update({ first_name: "​" })
      .eq("id", user.id)
      .select("id");

    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
    expect((await profileOf(user.id)).first_name).toBe("Ada");
  });
});
