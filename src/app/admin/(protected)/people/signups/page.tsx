import Link from "next/link";
import { requirePermission } from "@/lib/admin/require-admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { listSignups } from "@/lib/admin/people/queries";
import { PAGE_SIZE, describeFilters, parseSignupListParams } from "@/lib/admin/people/signups";
import { NewSignupsBadge } from "@/components/admin/new-signups-badge";
import { QueueHeader } from "@/components/admin/queue-chrome";
import { Container, Card, Button, TextField } from "@/components/ui";

export const metadata = {
  title: "Job-seeker signups — Talentrah admin",
  robots: { index: false, follow: false },
};

/** Always fresh: a cached list of who signed up would defeat the point. */
export const dynamic = "force-dynamic";

/**
 * Every job seeker, newest first.
 *
 * ── THIS IS A REVERSAL, AND IT IS SUPPOSED TO BE ──────────────────────────
 *
 * /admin/people is a one-person-at-a-time billing lookup whose own comments say
 * there is no list, no pagination and no way to enumerate, because "the absence
 * is the feature". That page and that reasoning are untouched; this is a
 * separate capability, asked for after the trade was spelled out.
 *
 * What the old design bought was that fishing was IMPOSSIBLE rather than
 * discouraged. That is gone here, by request. What stands in its place:
 *
 *   1. Browsing is recorded. `people.listed` is written for the list itself,
 *      not only for opening one person — a page showing fifty people is not
 *      one lookup, and an audit trail that only sees the fifty-first would
 *      describe the least of what happened.
 *   2. The operator is told so, above the table, in the same voice the lookup
 *      page uses. The log is what answers a question afterwards; the sentence
 *      is what changes whether the idle browse happens at all.
 *   3. The exclusion the lookup page names — "no resumes, no applications, no
 *      tailoring history" — is unchanged and enforced by a whitelist rather
 *      than by remembering (src/lib/admin/people/signups.ts).
 *
 * ── WHAT WRITES AN AUDIT ENTRY, EXACTLY ───────────────────────────────────
 *
 * One `people.listed` per server render of THIS page — so a first load, a
 * filter change, and a page-2 click are three entries, because they are three
 * distinct sets of people put on a screen. Two loads with nothing new between
 * them are two entries too: the design calls for one per view, not one per
 * distinct result, because "who looked, and when" is the question the trail
 * answers. What does NOT log is the "new since you loaded" poll, which returns
 * a count and no rows (see countNewSignupsAction).
 */
export default async function SignupsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
   * `people_list`, NOT `people` (0103). The billing lookup next door stays on
   * `people`: looking up one record you already have an identifier for and
   * reading the whole roster are separate powers, and one permission covering
   * both handed the second to anyone who needed the first.
   */
  const admin = await requirePermission("people_list");
  const spec = parseSignupListParams(await searchParams);
  const { rows, total, page, pageCount } = await listSignups(spec);

  /*
   * Logged AFTER the query, so a filter that returned nothing still records the
   * attempt, and a query that threw records nothing — an entry for a page that
   * never rendered would be a false positive in the one log that must not have
   * them. `returned` is a count, never the ids: the trail says what was looked
   * at, not who, which is what the filters already describe.
   */
  await recordAdminAction({
    identity: admin,
    action: "people.listed",
    targetTable: "profiles",
    detail: { ...describeFilters(spec), returned: rows.length, total },
  });

  const loadedAt = new Date().toISOString();
  const qs = (next: Partial<{ page: number }>) => {
    const p = new URLSearchParams();
    if (spec.email) p.set("email", spec.email);
    if (spec.from) p.set("from", spec.from);
    if (spec.to) p.set("to", spec.to);
    const target = next.page ?? page;
    if (target > 1) p.set("page", String(target));
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <Container className="flex max-w-[1120px] flex-col gap-8 py-12">
      <QueueHeader
        eyebrow="Job-seeker signups"
        title="Who has signed up."
        blurb="Newest first. Job seekers only — employers live on the organisation side and are not listed here."
        adminLabel={admin.displayName || admin.email}
      />

      {/*
        The same notice the lookup page carries, for the same reason: the log is
        what answers the question later, and the sentence is what makes the
        casual browse less likely in the first place.
      */}
      <Card className="border-ink bg-coral-soft p-4">
        <p className="text-[14px] text-ink">
          <strong>Opening this list is recorded.</strong> Each view writes{" "}
          <code className="text-[13px]">people.listed</code> to the admin audit log against your
          account, with the filters you used — including when you change a filter or turn a page.
          Billing records only: no resumes, no applications, no tailoring history.
        </p>
      </Card>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-[260px] flex-1">
          <TextField
            id="signup-email"
            label="Email contains"
            name="email"
            type="search"
            autoComplete="off"
            defaultValue={spec.email ?? ""}
            placeholder="part of an address"
          />
        </div>
        <TextField id="signup-from" label="From" name="from" type="date" defaultValue={spec.from ?? ""} />
        <TextField id="signup-to" label="To" name="to" type="date" defaultValue={spec.to ?? ""} />
        <Button type="submit">Filter</Button>
        {(spec.email || spec.from || spec.to) && (
          <Link href="/admin/people/signups" className="text-[13.5px] underline">
            Clear
          </Link>
        )}
      </form>

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-[14px] text-ink-soft">
          {total === 0
            ? "No signups match."
            : `${total.toLocaleString()} ${total === 1 ? "person" : "people"} · page ${page} of ${pageCount}`}
        </p>
        <NewSignupsBadge since={loadedAt} />
      </div>

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b-[1.5px] border-ink text-left">
                <th className="py-2 pr-4 font-body text-[12px] uppercase tracking-[0.09em] text-ink-soft">Name</th>
                <th className="py-2 pr-4 font-body text-[12px] uppercase tracking-[0.09em] text-ink-soft">Email</th>
                <th className="py-2 pr-4 font-body text-[12px] uppercase tracking-[0.09em] text-ink-soft">Country</th>
                <th className="py-2 pr-4 font-body text-[12px] uppercase tracking-[0.09em] text-ink-soft">Signed up</th>
                <th className="py-2 pr-4 font-body text-[12px] uppercase tracking-[0.09em] text-ink-soft">Credits</th>
                <th className="py-2 pr-4 font-body text-[12px] uppercase tracking-[0.09em] text-ink-soft">Segment</th>
                <th className="py-2 font-body text-[12px] uppercase tracking-[0.09em] text-ink-soft">Referred by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line align-top" data-testid="signup-row">
                  {/* Name falls back to the address rather than showing a blank cell. */}
                  <td className="py-2.5 pr-4">{r.name ?? <span className="text-ink-soft">{r.email}</span>}</td>
                  <td className="py-2.5 pr-4 break-all">{r.email}</td>
                  <td className="py-2.5 pr-4">{r.country ?? "—"}</td>
                  <td className="py-2.5 pr-4 tabular-nums">
                    {new Date(r.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                  </td>
                  <td className="py-2.5 pr-4 tabular-nums">{r.creditsBalance}</td>
                  <td className="py-2.5 pr-4">{r.marketSegment}</td>
                  <td className="py-2.5 break-all">
                    {r.referredBy ? (r.referredByEmail ?? r.referredBy) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <nav className="flex items-center gap-4" aria-label="Pagination">
          {page > 1 ? (
            <Link href={`/admin/people/signups${qs({ page: page - 1 })}`} className="underline">
              ← Newer
            </Link>
          ) : (
            <span className="text-ink-soft">← Newer</span>
          )}
          <span className="text-[13.5px] text-ink-soft">
            {PAGE_SIZE} per page
          </span>
          {page < pageCount ? (
            <Link href={`/admin/people/signups${qs({ page: page + 1 })}`} className="underline">
              Older →
            </Link>
          ) : (
            <span className="text-ink-soft">Older →</span>
          )}
        </nav>
      )}

      <p className="text-[14px] text-ink-soft">
        Chasing one person&apos;s payment?{" "}
        <Link href="/admin/people" className="underline">
          The billing lookup
        </Link>{" "}
        answers that from an email, a user id or a Paystack reference.
      </p>
    </Container>
  );
}
