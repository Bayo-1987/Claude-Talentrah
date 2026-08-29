/**
 * Values the client component needs.
 *
 * Split from courses.ts because that module is `server-only` — importing it
 * from a Client Component fails the build, not at runtime. Same reason
 * src/lib/admin/cookie.ts exists apart from session.ts.
 */
export const PRICE_TIERS = ["free", "low", "mid", "high"] as const;
export type PriceTier = (typeof PRICE_TIERS)[number];
