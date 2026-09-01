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
 * COUNTS ARE WHY THE QUEUE LINKS EXIST. A moderation dashboard whose links do
 * not say how much is waiting makes an operator open several screens to learn
 * that most were empty. They are read live rather than cached, which costs one
 * query per counted area per navigation and is the right trade at this volume:
 * a stale "0" on a queue that has something in it is the failure that matters.
 *
 * NOT EVERY LINK IS A QUEUE, and the array below is split accordingly. This
 * comment used to say "only these three appear", and then named feedback
 * triage, user support and financial visibility as "real gaps, not shipped
 * features" — while all three sat in the list immediately underneath it. They
 * shipped; the sentence did not keep up. The rule it was protecting is still
 * right and still applies: a link to a page that does not exist reads as a
 * feature that does, which is why Billing and Analytics stay out of the
 * employer nav.
 *
 * WHAT DECIDES VISIBILITY IS THE PERMISSION, not the count. `permission` gates
 * rendering; `key` only names the queue count. They stay separate because the
 * count keys are the moderation queues' own names and predate 0075's catalog,
 * and collapsing them would tie a display concern to an access one.
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
 * Links with no count. These sit apart from ITEMS because a number beside them
 * would invent a backlog that does not exist — there is no queue of operators
 * waiting to be dealt with, and a blog post is not work arriving.
 *
 * HIDING A LINK IS UX, NOT ENFORCEMENT. Both entries are now backed by a
 * guard, so hiding them only spares an operator a bounce they would otherwise
 * take: requirePermission("operators"), ("blog") and ("feature_flags") refuse
 * anyone who types the URL — on the pages themselves, and again in their
 * Server Actions, which are reachable by POST without the page ever rendering.
 *
 * This note used to record Blog as NOT backed, because at the time the blog
 * pages asked only whether you were an admin. #167 closed that. The line is
 * updated rather than deleted, because the distinction it drew is the one that
 * matters here and will matter again for whatever entry somebody adds next: a
 * link is not a control, and a nav that hides something the server will
 * happily serve is a comfort rather than a boundary.
 */
const COUNTLESS_ITEMS = [
  { href: "/admin/blog", label: "Blog", permission: "blog" },
  { href: "/admin/feature-flags", label: "Feature flags", permission: "feature_flags" },
  { href: "/admin/operators", label: "Operators", permission: "operators" },
] as const;

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

      {COUNTLESS_ITEMS.filter((item) => permissions.includes(item.permission)).map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={path.startsWith(item.href) ? "page" : undefined}
          className={
            "inline-flex min-h-11 items-center font-body text-[14px] no-underline " +
            (path.startsWith(item.href) ? "font-semibold text-rust" : "text-ink hover:text-rust")
          }
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
