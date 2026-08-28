import type { Metadata } from "next";

/**
 * Everything under /admin, signed in or not.
 *
 * This layout deliberately does NOT guard. The guard lives one level down, in
 * (protected)/layout.tsx, because /admin/login has to render to someone who
 * is by definition not authenticated — and a guard in this file would either
 * have to special-case its own login page by path (a rule that breaks the
 * first time a route is added) or bounce the operator in a loop.
 *
 * The route group does that structurally instead: a page is protected because
 * of where it sits in the tree, not because it remembered to call something.
 */
export const metadata: Metadata = {
  title: "Talentrah admin",
  // Not a secret — the guard is what keeps people out — but nothing here
  // should be in an index either.
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
