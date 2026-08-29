/**
 * The person lookup's two load-bearing properties.
 *
 * M6 is the dashboard's first read-access-to-PII surface, and two claims make
 * it defensible rather than merely convenient:
 *
 *   1. IT CANNOT BE BROWSED. Exact match on one of three identifiers, or
 *      nothing. No substring, no prefix, no wildcard, no listing. If that ever
 *      relaxes, "an operator should not go fishing" stops being a property of
 *      the code and becomes a convention someone is trusted to keep.
 *   2. IT SHOWS BILLING ONLY. Resumes, tailoring content, applications and
 *      feedback are not fetched — not fetched-and-hidden, which is one
 *      careless render away from being shown.
 *
 * Both are asserted against the real database. The audit-logging half lives in
 * the Server Action, which needs an admin session; what this file proves is
 * that the RESOLVER refuses to enumerate, which is the part worth attacking.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { findPerson } from "@/lib/admin/finance/queries";

let alice: Awaited<ReturnType<typeof createTestUser>>;
let bob: Awaited<ReturnType<typeof createTestUser>>;

beforeAll(async () => {
  alice = await createTestUser("lookup-alice");
  bob = await createTestUser("lookup-bob");
});

afterAll(async () => {
  await deleteTestUsers([alice.id, bob.id]);
});

describe("resolves exactly one person, by an identifier you already have", () => {
  it("finds by exact email", async () => {
    expect((await findPerson(alice.email))?.id).toBe(alice.id);
  });

  it("finds by email regardless of case", async () => {
    // A support case arrives with whatever casing the customer typed.
    expect((await findPerson(alice.email.toUpperCase()))?.id).toBe(alice.id);
  });

  it("finds by user id", async () => {
    expect((await findPerson(alice.id))?.id).toBe(alice.id);
  });
});

describe("cannot be used to enumerate", () => {
  it("a substring of a real email matches nobody", async () => {
    // The whole design rests on this. The local part is a genuine prefix of a
    // real address; if prefix matching ever creeps in, this fails.
    const prefix = alice.email.split("@")[0];
    expect(await findPerson(prefix)).toBeNull();
    expect(await findPerson(prefix.slice(0, 6))).toBeNull();
  });

  it("a LIKE wildcard is a literal, not a pattern", async () => {
    // "%@%" would match every address on the platform if the term reached an
    // ilike unescaped.
    expect(await findPerson("%@%")).toBeNull();
    expect(await findPerson("%@talentrah.test")).toBeNull();
    expect(await findPerson("_" + alice.email.slice(1))).toBeNull();
  });

  it("the domain alone matches nobody", async () => {
    expect(await findPerson("@talentrah.test")).toBeNull();
  });

  it("an empty or whitespace term matches nobody", async () => {
    expect(await findPerson("")).toBeNull();
    expect(await findPerson("   ")).toBeNull();
  });

  it("a well-formed but unknown id matches nobody", async () => {
    expect(await findPerson(randomUUID())).toBeNull();
  });

  it("one person's identifier never returns another", async () => {
    const person = await findPerson(bob.email);
    expect(person?.id).toBe(bob.id);
    expect(person?.id).not.toBe(alice.id);
  });
});

describe("the record carries billing fields and nothing else", () => {
  it("exposes no resume, application, tailoring or feedback data", async () => {
    const person = await findPerson(alice.email);
    expect(person).not.toBeNull();

    // Asserted on the SHAPE, not on values, so it fails the moment somebody
    // adds a field — which is exactly when the privacy decision would be
    // getting made by accident.
    expect(Object.keys(person!).sort()).toEqual(
      [
        "country",
        "createdAt",
        "credits",
        "creditsBalance",
        "email",
        "firstName",
        "id",
        "lastName",
        "passes",
        "payments",
      ].sort(),
    );
  });

  it("returns the person's own rows only, and a reference resolves to its owner", async () => {
    // product_id is NOT optional for a credit_pack — payment_transactions
    // _product_id_required enforces it, which the first version of this test
    // discovered the honest way (23514).
    const { data: pack } = await admin.from("credit_packs").select("id").limit(1).maybeSingle();
    if (!pack) return expect(pack).toBeNull(); // no reference data seeded

    const reference = `LOOKUP-TEST-${randomUUID()}`;
    const { error } = await admin.from("payment_transactions").insert({
      user_id: bob.id,
      rail: "paystack",
      amount: 250000,
      currency: "NGN",
      product_type: "credit_pack",
      product_id: pack.id,
      paystack_reference: reference,
      status: "success",
    });
    expect(error).toBeNull();

    const aliceRecord = await findPerson(alice.email);
    expect(aliceRecord!.payments.map((p) => p.reference)).not.toContain(reference);

    // The support path a disputed charge actually arrives by.
    expect((await findPerson(reference))?.id).toBe(bob.id);

    const { error: cleanupError } = await admin
      .from("payment_transactions")
      .delete()
      .eq("paystack_reference", reference);
    if (cleanupError) console.warn(`[cleanup] fixture payment survived: ${cleanupError.message}`);
  });
});
