/**
 * ACCT-1 PR 1 — a person whose account is scheduled for deletion receives NO email, from any sender, including ones written later.
 *
 * Fifteen places call `getResendClient()` and each picks its own recipients. Teaching each of them about the deletion flag is how the sixteenth
 * forgets, so the guard sits where they all pass: the client `getResendClient()` returns. Its `emails.send` looks the recipients up and drops the
 * ones whose profile carries `deletion_requested_at`.
 *
 * What is pinned: a pending recipient is not sent to; a normal one is; a mixed list sends only to the normal ones; the "suppressed" outcome is
 * a success shape (so a digest or reminder is not retried forever for someone who is gone); and if the lookup itself fails the send FAILS CLOSED
 * with an error, because "stop all email" must not turn into "send everything" when the database blips.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sent: [] as Array<Record<string, unknown>>,
  pendingEmails: new Set<string>(),
  lookupError: null as null | { message: string },
  lookups: [] as string[][],
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: Record<string, unknown>) => {
        state.sent.push(payload);
        return { data: { id: "real-send" }, error: null };
      },
    };
  },
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      expect(table).toBe("profiles");
      return {
        select: () => ({
          in: (_col: string, values: string[]) => ({
            not: async () => {
              state.lookups.push(values);
              if (state.lookupError) return { data: null, error: state.lookupError };
              return {
                data: values.filter((v) => state.pendingEmails.has(v.toLowerCase())).map((email) => ({ email })),
                error: null,
              };
            },
          }),
        }),
      };
    },
  }),
}));

import { getResendClient } from "@/lib/resend/client";

const base = { from: "Talentrah <noreply@talentrah.com>", subject: "s", text: "t" };

beforeEach(() => {
  state.sent.length = 0;
  state.pendingEmails.clear();
  state.lookups.length = 0;
  state.lookupError = null;
  process.env.RESEND_API_KEY = "re_test_key_not_real";
});

describe("getResendClient with the deletion guard", () => {
  it("still returns null when no key is configured (callers' own fallback is unchanged)", () => {
    delete process.env.RESEND_API_KEY;
    expect(getResendClient()).toBeNull();
  });

  it("sends to an ordinary recipient, untouched", async () => {
    const client = getResendClient()!;
    const res = await client.emails.send({ ...base, to: "ada@example.com" });
    expect(res.error).toBeNull();
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].to).toBe("ada@example.com");
  });

  it("does NOT send to a recipient whose account is scheduled for deletion, and reports a success shape", async () => {
    state.pendingEmails.add("gone@example.com");
    const client = getResendClient()!;
    const res = await client.emails.send({ ...base, to: "gone@example.com" });
    expect(state.sent).toHaveLength(0);
    expect(res.error).toBeNull();
    expect(res.data?.id).toBe("suppressed-account-deletion");
  });

  it("matches the address whatever its case", async () => {
    state.pendingEmails.add("gone@example.com");
    const client = getResendClient()!;
    await client.emails.send({ ...base, to: "Gone@Example.com" });
    expect(state.sent).toHaveLength(0);
  });

  it("with a list, sends only to the recipients who are not pending", async () => {
    state.pendingEmails.add("gone@example.com");
    const client = getResendClient()!;
    await client.emails.send({ ...base, to: ["gone@example.com", "stays@example.com"] });
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].to).toEqual(["stays@example.com"]);
  });

  it("looks the recipients up by address, in one query, for every send", async () => {
    const client = getResendClient()!;
    await client.emails.send({ ...base, to: "ada@example.com" });
    await client.emails.send({ ...base, to: "bo@example.com" });
    expect(state.lookups).toHaveLength(2);
    expect(state.lookups[0]).toContain("ada@example.com");
  });

  it("FAILS CLOSED when the lookup errors: nothing is sent and the caller sees an error", async () => {
    state.lookupError = { message: "connection reset" };
    const client = getResendClient()!;
    const res = await client.emails.send({ ...base, to: "ada@example.com" });
    expect(state.sent).toHaveLength(0);
    expect(res.data).toBeNull();
    expect(res.error?.message).toMatch(/recipient check failed/i);
  });

  it("does not interfere with anything other than emails.send", () => {
    const client = getResendClient()!;
    expect(typeof client.emails.send).toBe("function");
  });
});
