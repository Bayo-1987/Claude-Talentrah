import "server-only";
import { getResendClient } from "@/lib/resend/client";
import {
  DEFAULT_PROVIDER_DAILY_LIMIT,
  DEFAULT_PROVIDER_MONTHLY_LIMIT,
} from "@/lib/email/mass-send-config";
import type { MassEmail, MassMailProvider, ProviderSendResult, QuotaReading } from "@/lib/email/mass-send";

/**
 * The real provider behind the mass-send port.
 *
 * It reaches the provider's SDK object through `getResendClient()` (the one door the standing test requires) and uses ONLY the batch endpoint. It never calls the guarded
 * single-send method: the batch endpoint is not covered by that guard, so the deletion filtering happens before each batch in the runner, and the standing test
 * tests/email/mass-send-never-uses-the-guarded-send.test.ts keeps this file from reaching the single-send method.
 *
 * ── WHAT IS NOT PROVEN HERE ─────────────────────────────────────────────
 * No test in this repository calls the real provider. The header names below, and whether the two "quota" headers report what has been USED or what is LEFT, are taken from
 * the provider's documentation and have not been observed against a live response. They are read as "used so far" and turned into "left" with the plan limits in
 * mass-send-config.ts. If a header is missing or unreadable the reading is null for that field, and the runner refuses to start without any quota reading: the failure is "no
 * mass email", never "mass email with no limit". The first live send is the check; the owner turns `admin_email` on himself.
 */
export const QUOTA_HEADERS = {
  dailyUsed: "x-resend-daily-quota",
  monthlyUsed: "x-resend-monthly-quota",
  rateRemaining: "ratelimit-remaining",
  retryAfter: "retry-after",
} as const;

function headerNumber(headers: Record<string, string> | null | undefined, name: string): number | null {
  if (!headers) return null;
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    const n = Number(headers[key]);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

function limitFromEnv(name: string, fallback: number, env: Record<string, string | undefined>): number {
  const n = Number(env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Turns a response's headers into a quota reading. Exported so the parsing can be tested without a provider. */
export function parseQuotaHeaders(headers: Record<string, string> | null | undefined, env: Record<string, string | undefined> = process.env): QuotaReading | null {
  if (!headers) return null;
  const dailyUsed = headerNumber(headers, QUOTA_HEADERS.dailyUsed);
  const monthlyUsed = headerNumber(headers, QUOTA_HEADERS.monthlyUsed);
  const reading: QuotaReading = {
    rateRemaining: headerNumber(headers, QUOTA_HEADERS.rateRemaining),
    dailyRemaining: dailyUsed === null ? null : Math.max(0, limitFromEnv("MASS_EMAIL_PROVIDER_DAILY_LIMIT", DEFAULT_PROVIDER_DAILY_LIMIT, env) - dailyUsed),
    monthlyRemaining: monthlyUsed === null ? null : Math.max(0, limitFromEnv("MASS_EMAIL_PROVIDER_MONTHLY_LIMIT", DEFAULT_PROVIDER_MONTHLY_LIMIT, env) - monthlyUsed),
  };
  return reading.rateRemaining === null && reading.dailyRemaining === null && reading.monthlyRemaining === null ? null : reading;
}

type ProviderError = { name?: string; statusCode?: number | null } | null | undefined;

/** Sorts a provider error into the four answers the runner acts on. A name the provider adds later falls into "unknown": stop, never guess. */
export function classifyProviderError(error: ProviderError, headers: Record<string, string> | null | undefined, quota: QuotaReading | null): ProviderSendResult {
  const name = error?.name ?? "";
  if (name === "daily_quota_exceeded") return { kind: "quota_exceeded", scope: "daily" };
  if (name === "monthly_quota_exceeded") return { kind: "quota_exceeded", scope: "monthly" };
  if (name === "rate_limit_exceeded" || error?.statusCode === 429) {
    return { kind: "rate_limited", retryAfterSec: headerNumber(headers, QUOTA_HEADERS.retryAfter), quota };
  }
  if (name === "validation_error" || name === "invalid_parameter" || name === "missing_required_field" || name === "invalid_from_address" || name === "invalid_idempotency_key") {
    return { kind: "rejected" };
  }
  return { kind: "unknown" };
}

type BatchClient = NonNullable<ReturnType<typeof getResendClient>>;

export function createResendMassProvider(getClient: () => BatchClient | null = getResendClient): MassMailProvider {
  return {
    async readQuota() {
      const client = getClient();
      if (!client) return null;
      try {
        // A read call, not a send: it costs no email and carries the same response headers.
        const response = await client.domains.list();
        return parseQuotaHeaders(response.headers);
      } catch {
        return null;
      }
    },

    async sendBatch(emails: MassEmail[], options: { idempotencyKey: string }): Promise<ProviderSendResult> {
      const client = getClient();
      if (!client) return { kind: "rejected" };
      try {
        const response = await client.batch.send(
          emails.map((e) => ({
            from: e.from,
            to: [e.to],
            subject: e.subject,
            html: e.html,
            text: e.text,
            headers: e.headers,
            ...(e.replyTo ? { replyTo: e.replyTo } : {}),
          })),
          { idempotencyKey: options.idempotencyKey },
        );
        const quota = parseQuotaHeaders(response.headers);
        if (response.error) return classifyProviderError(response.error, response.headers, quota);
        return { kind: "ok", quota };
      } catch {
        return { kind: "unknown" };
      }
    },
  };
}
