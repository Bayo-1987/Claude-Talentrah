import "server-only";
import { headers } from "next/headers";

/**
 * The absolute origin this request arrived on.
 *
 * Factored out of `getReferralUrl` rather than copied: job sharing needs the
 * same value, and two hand-rolled `x-forwarded-*` readers drift the first time
 * one of them is fixed.
 */
export async function getSiteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const protocol = h.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

/** Builds an absolute /signup?ref= link — same query param signup/page.tsx already reads. */
export async function getReferralUrl(referralCode: string): Promise<string> {
  return `${await getSiteOrigin()}/signup?ref=${referralCode}`;
}
