"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { backLinkFor } from "@/lib/talent-directory/how-we-review-link";

/**
 * "← Back to <label>" on the How we review page (HWR-1). A client island so the page itself stays static: it reads `?from=` in the browser, so the cached page and
 * what a crawler gets never change, and a visitor with no `from` (or a hostile one) gets nothing at all. Mounted inside <Suspense> by the page (a static page may not
 * read the query string outside one). The allow-list and the checks are in how-we-review-link.ts.
 */
export function HowWeReviewBackLink() {
  const params = useSearchParams();
  const link = backLinkFor(params?.get("from"));
  if (!link) return null;
  return (
    <Link href={link.href} className="inline-flex min-h-11 items-center self-start font-body text-[14px] font-semibold text-rust underline underline-offset-2 hover:text-rust-hover">
      ← Back to {link.label}
    </Link>
  );
}
