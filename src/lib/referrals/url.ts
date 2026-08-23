import "server-only";
import { headers } from "next/headers";

/** Builds an absolute /signup?ref= link — same query param signup/page.tsx already reads. */
export async function getReferralUrl(referralCode: string): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const protocol = h.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}/signup?ref=${referralCode}`;
}
