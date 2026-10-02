import "server-only";
import { Resend } from "resend";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Shared Resend client for transactional/notification email. Returns null rather than throwing when unconfigured: callers decide what "no client"
 * means for them (the Contact form has a real fallback in the mailto link on the page itself).
 *
 * ── THE ACCOUNT-DELETION GUARD (ACCT-1) ───────────────────────────────────
 *
 * Fifteen places call this and each picks its own recipients. A person whose account is scheduled for deletion (`profiles.deletion_requested_at`)
 * must receive NO email from any of them, including senders written later, so the guard sits where they all pass: the client returned here has an
 * `emails.send` that looks the recipients up by address and drops the ones whose profile carries the flag. tests/email/every-sender-uses-the-
 * guarded-client.test.ts keeps this the only door to the provider.
 *
 *   - A recipient that is dropped is reported as a SUCCESS (`id: "suppressed-account-deletion"`): callers record "sent" and move on, instead of
 *     retrying every run for someone who is leaving. Restoring the account resumes mail from the next send.
 *   - If the lookup itself FAILS the send fails too, with an error the caller already handles. "Stop all email" must not become "send everything"
 *     when the database blips.
 *   - Not a profile (the Contact form's own inbox, an admin alert address) matches no row and is untouched.
 */
export function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return withDeletionGuard(new Resend(apiKey));
}

type SendFn = Resend["emails"]["send"];
type SendPayload = Parameters<SendFn>[0];
type SendResult = Awaited<ReturnType<SendFn>>;

/** "Ada <ada@x.com>" and "ada@x.com" both reduce to the bare address. */
function addressOf(recipient: string): string {
  const m = /<([^>]+)>\s*$/.exec(recipient);
  return (m ? m[1] : recipient).trim();
}

function asList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

async function pendingAddresses(addresses: string[]): Promise<Set<string>> {
  const variants = [...new Set(addresses.flatMap((a) => [a, a.toLowerCase()]))];
  const { data, error } = await createServiceRoleClient()
    .from("profiles")
    .select("email")
    .in("email", variants)
    .not("deletion_requested_at", "is", null);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => (r.email ?? "").toLowerCase()));
}

function withDeletionGuard(client: Resend): Resend {
  const emails = client.emails;
  const guardedEmails = new Proxy(emails, {
    get(target, prop, receiver) {
      if (prop !== "send") {
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      }
      const send = (async (payload: SendPayload, options?: Parameters<SendFn>[1]): Promise<SendResult> => {
        const all = [...asList(payload.to), ...asList(payload.cc), ...asList(payload.bcc)];
        let pending: Set<string>;
        try {
          pending = await pendingAddresses(all.map(addressOf));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[email] recipient check failed, not sending:", message);
          return { data: null, error: { message: `recipient check failed: ${message}`, name: "application_error" } } as unknown as SendResult;
        }
        if (pending.size === 0) return target.send(payload, options);

        const keep = (v: string | string[] | undefined) => {
          if (v === undefined) return undefined;
          const kept = asList(v).filter((r) => !pending.has(addressOf(r).toLowerCase()));
          return Array.isArray(v) ? kept : kept[0];
        };
        const to = keep(payload.to);
        if (asList(to).length === 0) {
          return { data: { id: "suppressed-account-deletion" }, error: null } as unknown as SendResult;
        }
        return target.send({ ...payload, to, cc: keep(payload.cc), bcc: keep(payload.bcc) } as SendPayload, options);
      }) as SendFn;
      return send;
    },
  });
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "emails") return guardedEmails;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Inbox the Contact form (and any future transactional notices) send to. */
export function getContactRecipient(): string {
  return process.env.CONTACT_EMAIL_TO || "support@talentrah.com";
}
