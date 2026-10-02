import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isDevFixtureAllowed } from "@/lib/dev/dev-fixture-guard";

/**
 * Every route under /dev/ is a QA fixture: real components, no auth, no database, built so an e2e can drive them. They
 * must never be served by the live site. One guard HERE covers every page beneath it, so a fixture added later is closed by
 * default (tests/dev/dev-routes-guarded.test.ts fails if that stops being true). `isDevFixtureAllowed` keys on
 * `VERCEL_ENV` because CI exercises the same production build (`NODE_ENV=production`) the live site runs.
 *
 * `noindex` and robots.txt's `Disallow: /dev/` are a second layer behind the 404.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (!isDevFixtureAllowed()) notFound();
  return <>{children}</>;
}
