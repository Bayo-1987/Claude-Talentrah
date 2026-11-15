/**
 * Transactional sends are NOT counted and NOT blocked by the mass-email limits.
 *
 * At the provider's limit Resend refuses ALL mail, deletion confirmations and export links included, which is why the owner's cap and ceiling sit below it. The other half of
 * that promise is this one: when the mass-email cap and the monthly ceiling are both reached, a single transactional email still reaches `emails.send`, unchanged, because it
 * never touches the delivery ledger or the settings.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const providerCalls = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: Record<string, unknown>) => {
        providerCalls.push(payload);
        return { data: { id: "mock" }, error: null };
      },
    };
  },
}));
// The guarded client looks recipients up before it sends: nobody here is pending deletion.
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "in", "not", "eq", "is"]) chain[m] = () => chain;
      (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(resolve);
      return chain;
    },
  }),
}));

import { getResendClient, sendDeletionLifecycleEmail } from "@/lib/resend/client";
import { fakeSecret } from "../support/fake-secret";
import { makeWorld } from "./mass-send-support";

beforeEach(() => {
  providerCalls.length = 0;
  process.env.RESEND_API_KEY = fakeSecret("resendKey");
});

describe("a single transactional send still works while the mass-email cap and the monthly ceiling are reached", () => {
  it("the deletion confirmation and the export notice reach emails.send unchanged, with both limits reached", async () => {
    const w = makeWorld({ people: 2, cap: 1, ceiling: 1 });
    const m = await w.startedMessage();
    const { runEmailSend } = await import("@/lib/notifications/admin-messages/run-email");
    const mass = await runEmailSend(w.deps, m.id);
    expect(mass.status).toBe("paused_email_cap"); // the limits are reached: one mass email went, the next claim was refused
    expect((await w.backend.claimNotification({ p_user: "00000000-0000-4000-8000-000000000001", p_kind: "admin_message", p_subject: "00000000-0000-4000-8000-0000000000aa", p_channel: "email" })).refused).toBe("cap_24h");
    const ledgerBefore = w.backend.deliveries.length;

    const confirm = await sendDeletionLifecycleEmail("deletion_confirm", { from: "Talentrah <hello@talentrah.com>", to: "zq7.owner@example.test", subject: "Confirm", text: "t", html: "<p>t</p>" });
    const notice = await sendDeletionLifecycleEmail("data_export_generated", { from: "Talentrah <hello@talentrah.com>", to: "zq7.owner@example.test", subject: "Export", text: "t", html: "<p>t</p>" });
    expect(confirm.error).toBeNull();
    expect(notice.error).toBeNull();
    expect(providerCalls).toHaveLength(2);
    expect(providerCalls[0]).toMatchObject({ to: "zq7.owner@example.test", subject: "Confirm", headers: { "X-Talentrah-Template": "deletion_confirm" } });
    expect(providerCalls[1]).toMatchObject({ subject: "Export", headers: { "X-Talentrah-Template": "data_export_generated" } });

    expect(w.backend.deliveries.length).toBe(ledgerBefore); // they used no claim, so they were neither counted nor blocked
  });

  it("an ordinary guarded transactional send (a receipt) also goes through, with both limits reached", async () => {
    const w = makeWorld({ people: 1, cap: 0, ceiling: 0 });
    const m = await w.startedMessage();
    const { runEmailSend } = await import("@/lib/notifications/admin-messages/run-email");
    expect((await runEmailSend(w.deps, m.id)).sent).toBe(0);

    const client = getResendClient();
    expect(client).not.toBeNull();
    const result = await client!.emails.send({ from: "Talentrah <billing@talentrah.com>", to: "zq7.buyer@example.test", subject: "Receipt", text: "t" });
    expect(result.error).toBeNull();
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]).toMatchObject({ from: "Talentrah <billing@talentrah.com>", subject: "Receipt" });
  });
});
