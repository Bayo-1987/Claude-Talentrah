import Link from "next/link";
import { headers } from "next/headers";
import { queueCounts } from "@/lib/admin/moderation/queues";
import { PATH_HEADER } from "@/lib/auth/redirect-to";
import type { AdminPermission } from "@/lib/admin/session";

/**
 * The dashboard's own nav, across the moderation areas.
 *
 * Not the seeker masthead and not a variant of it — CLAUDE.md's "the masthead
 * doubles as app nav" rule is about the consumer product, and an operator here
 * is not a job seeker. Sharing that component would put Jobs / Job Tracker /
 * Resume Builder above a moderation queue.
 *
 * THE COUNTS ARE THE NAV'S REASON TO EXIST. A moderation dashboard whose links
 * do not say how much is waiting makes an operator open three screens to learn
 * that two were empty. They are read live rather than cached, which costs
 * three queries per admin navigation and is the right trade at this volume:
 * a stale "0" on a queue that has something in it is the failure that matters.
 *
 * Only these three appear. Feedback triage, user support, financial visibility
 * and the rest of the domain map are real gaps, not shipped features, and a
 * link to a page that does not exist reads as one — the same rule that keeps
 * Billing and Analytics out of the employer nav.
 */
/*
 * `permission` is what decides whether a link is rendered; `key` still names
 * the queue count. They are separate on purpose — the count keys are the
 * moderation queues' own names and predate 0075's catalog, and collapsing them
 * would tie a display concern to an access one.
 */
const ITEMS = [
  { href: "/admin/scholarships", label: "Scholarships", key: "scholarships", permission: "scholarships" },
  { href: "/admin/reports", label: "Reported postings", key: "reports", permission: "reported_postings" },
  { href: "/admin/campaigns", label: "Ad campaigns", key: "campaigns", permission: "ad_campaigns" },
  { href: "/admin/feedback", label: "Feedback", key: "feedback", permission: "feedback" },
  { href: "/admin/courses", label: "Courses", key: "courses", permission: "courses" },
  { href: "/admin/ops", label: "Operations", key: "ops", permission: "operations" },
  /*
   * Finance is in the nav; the PERSON LOOKUP is not, and that is deliberate.
   * It is one click from here, but nobody should land on a PII surface while
   * on their way somewhere else — which is the same argument that keeps the
   * finance page itself free of names.
   */
  { href: "/admin/finance", label: "Finance", key: "finance", permission: "finance" },
] as const;

/*
 * Operators sits apart from ITEMS because it is the only link that is not for
 * everybody, and because it has no queue count — there is no backlog of
 * operators waiting to be dealt with, and a "0" beside it would invent one.
 *
 * HIDING IT IS UX, NOT ENFORCEMENT. A standard admin who types the URL is
 * refused by requireSuperAdmin() on the page itself. This only keeps a link
 * out of their way that would bounce them if they followed it — the same
 * distinction already written down about the proxy's cookie check.
 */
const OPERATORS_LINK = { href: "/admin/operators", label: "Operators" } as const;

export async function AdminNav({ permissions }: { permissions: readonly AdminPermission[] }) {
  /*
   * The active link comes from the path header the proxy already stamps on
   * every request (src/lib/supabase/middleware.ts), for the same reason
   * requireUser() uses it: a layout is a Server Component with no request
   * object, and `headers()` is the only channel. Passing `current` down from
   * each page instead would mean every new admin page has to remember to, and
   * forgetting shows up as a nav that highlights nothing.
   *
   * Untrusted, like everywhere else it is read — a client can send this header
   * too. Here the worst case is the wrong link being bold, so it is compared
   * rather than sanitised.
   */
  const [counts, headerList] = await Promise.all([queueCounts(), headers()]);
  const path = headerList.get(PATH_HEADER) ?? "";

  return (
    <nav className="flex flex-wrap items-center gap-x-7 gap-y-2 border-b border-line px-10 py-3">
      {ITEMS.filter((item) => permissions.includes(item.permission)).map((item) => {
        const count = counts[item.key];
        const active = path.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              "inline-flex min-h-11 items-center gap-2 font-body text-[14px] no-underline " +
              (active ? "font-semibold text-rust" : "text-ink hover:text-rust")
            }
          >
            {item.label}
            {/*
              A zero is stated, not hidden. "Scholarships" with no number is
              ambiguous between "nothing waiting" and "not loaded"; "0" is an
              answer.
            */}
            <span
              className={
                "min-w-6 px-1.5 py-0.5 text-center font-body text-[12px] font-bold " +
                (count > 0 ? "bg-ink text-paper" : "bg-transparent text-ink-soft")
              }
            >
              {count}
            </span>
          </Link>
        );
      })}

      {permissions.includes("operators") && (
        <Link
          href={OPERATORS_LINK.href}
          aria-current={path.startsWith(OPERATORS_LINK.href) ? "page" : undefined}
          className={
            "inline-flex min-h-11 items-center font-body text-[14px] no-underline " +
            (path.startsWith(OPERATORS_LINK.href)
              ? "font-semibold text-rust"
              : "text-ink hover:text-rust")
          }
        >
          {OPERATORS_LINK.label}
        </Link>
      )}
    </nav>
  );
}
