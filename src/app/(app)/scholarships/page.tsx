import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { EyebrowLabel } from "@/components/ui";
import { ScholarshipFilterBar } from "@/components/scholarships/scholarship-filter-bar";
import {
  ScholarshipCard,
  daysUntil,
  formatDeadline,
} from "@/components/scholarships/scholarship-card";
import { Constants, type Tables } from "@/lib/supabase/types";
import type { DegreeLevel, FundingType, SaveStatus } from "@/lib/scholarships/types";
import { checkPassCoverage } from "@/lib/passes/entitlement";

export const metadata = { title: "Scholarships — Talentrah" };

type SearchParams = Promise<{
  tab?: string;
  level?: string;
  funding?: string;
  within?: string;
  field?: string;
  q?: string;
  page?: string;
}>;

const PAGE_SIZE = 5;
/** Saved/applying items inside this window get the deadline callout (§6.10's 14-day transactional reminder). */
const DEADLINE_ALERT_DAYS = 14;

const VALID_LEVELS: readonly string[] = Constants.public.Enums.scholarship_degree_level;
const VALID_FUNDING: readonly string[] = Constants.public.Enums.scholarship_funding_type;

export default async function ScholarshipsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, profile } = await requireUser();
  const params = await searchParams;
  const passCoverage = await checkPassCoverage(user.id);

  const tab = params.tab === "saved" ? "saved" : "all";
  const level = VALID_LEVELS.includes(params.level ?? "") ? (params.level as DegreeLevel) : undefined;
  const funding = VALID_FUNDING.includes(params.funding ?? "")
    ? (params.funding as FundingType)
    : undefined;
  const within = ["30", "90", "180"].includes(params.within ?? "") ? params.within : undefined;
  const field = params.field?.trim() || undefined;
  const q = params.q?.trim() || undefined;
  const page = Math.max(1, Number(params.page ?? "1") || 1);

  const supabase = await createClient();

  // Saves first — needed both for the "Saved" tab filter and to mark cards.
  const { data: saves } = await supabase
    .from("scholarship_saves")
    .select("id, scholarship_id, status")
    .eq("user_id", user.id);
  const saveByScholarshipId = new Map(
    (saves ?? []).map((s) => [s.scholarship_id, { id: s.id, status: s.status as SaveStatus }]),
  );

  /*
   * NOTE ON THE MODERATION GATE (§6.15): there is deliberately no
   * .eq("moderation_status", "verified") here. The gate lives in RLS
   * (migration 0020) — the authenticated role can only ever SELECT rows
   * where moderation_status = 'verified'. Enforcing it here as well would
   * imply the filter is what's protecting users, and the next page that
   * forgets it would silently leak an unreviewed listing. This query is
   * unfiltered on purpose and still cannot see pending rows.
   */
  let query = supabase.from("scholarships").select("*", { count: "exact" });

  if (level) query = query.contains("degree_levels", [level]);
  if (funding) query = query.eq("funding_type", funding);
  if (field) query = query.contains("field_tags", [field]);
  if (q) {
    query = query.or(
      `provider.ilike.%${q}%,program_name.ilike.%${q}%,host_institution.ilike.%${q}%`,
    );
  }
  if (within) {
    const horizon = new Date();
    horizon.setUTCDate(horizon.getUTCDate() + Number(within));
    query = query
      .not("application_deadline", "is", null)
      .gte("application_deadline", new Date().toISOString().slice(0, 10))
      .lte("application_deadline", horizon.toISOString().slice(0, 10));
  }
  if (tab === "saved") {
    const ids = [...saveByScholarshipId.keys()];
    query = query.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }

  const from = (page - 1) * PAGE_SIZE;
  const {
    data: rows,
    count,
    error,
  } = await query
    // Nulls last so listings with a published date lead — an unpublished
    // deadline is the least actionable thing on the page, not the most.
    .order("application_deadline", { ascending: true, nullsFirst: false })
    .range(from, from + PAGE_SIZE - 1);

  const scholarships: Tables<"scholarships">[] = rows ?? [];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // §6.10/§6.15's deadline reminder, in-app surface. Computed from the
  // user's own saves rather than the current page, so it doesn't vanish
  // when they filter or paginate away from the listing in question.
  const savedIds = [...saveByScholarshipId.entries()]
    .filter(([, s]) => s.status === "saved" || s.status === "applying")
    .map(([id]) => id);
  const { data: dueSoonRows } = savedIds.length
    ? await supabase
        .from("scholarships")
        .select("id, program_name, provider, application_deadline, official_url")
        .in("id", savedIds)
        .not("application_deadline", "is", null)
        .gte("application_deadline", new Date().toISOString().slice(0, 10))
    : { data: [] };
  const dueSoon = (dueSoonRows ?? [])
    .map((s) => ({ ...s, left: daysUntil(s.application_deadline) }))
    .filter((s) => s.left !== null && s.left <= DEADLINE_ALERT_DAYS)
    .sort((a, b) => (a.left ?? 0) - (b.left ?? 0));

  const buildPageHref = (target: number) => {
    const sp = new URLSearchParams();
    if (tab !== "all") sp.set("tab", tab);
    if (level) sp.set("level", level);
    if (funding) sp.set("funding", funding);
    if (within) sp.set("within", within);
    if (field) sp.set("field", field);
    if (q) sp.set("q", q);
    if (target > 1) sp.set("page", String(target));
    const qs = sp.toString();
    return qs ? `/scholarships?${qs}` : "/scholarships";
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <EyebrowLabel>Funding for your next degree</EyebrowLabel>
        <h1 className="mt-1.5 text-[26px]">Scholarships</h1>
        <p className="mt-1 max-w-[620px] text-[14px] text-ink-soft">
          Browsing, saving and tracking are free and unlimited. Every listing links
          out to the official page — that page is always the authority on current terms.
        </p>
      </div>

      {dueSoon.length > 0 && (
        <div className="flex flex-col gap-2 border-[1.5px] border-rust bg-rust-soft p-4">
          <EyebrowLabel size="sm">Deadlines coming up</EyebrowLabel>
          <ul className="flex flex-col gap-1">
            {dueSoon.map((s) => (
              <li key={s.id} className="text-[13.5px] text-ink">
                <span className="font-semibold">{s.program_name}</span> ({s.provider}) closes{" "}
                {formatDeadline(s.application_deadline)} —{" "}
                <span className="font-semibold text-rust">
                  {s.left} {s.left === 1 ? "day" : "days"} left
                </span>
                .{" "}
                <a
                  href={s.official_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-rust"
                >
                  Official page
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 text-[13.5px]">
        {/*
          `<Link>`, not `<a>` — this was silent until a sibling dynamic route
          existed under /scholarships/ to trip Next's own
          no-html-link-for-pages check against. Fixed here rather than left,
          since it is now a real lint failure for anyone building this file.
        */}
        <Link
          href="/scholarships"
          className={
            tab === "all"
              ? "font-semibold text-rust underline underline-offset-2"
              : "text-ink-soft underline underline-offset-2 hover:text-rust"
          }
        >
          All scholarships
        </Link>
        <Link
          href="/scholarships?tab=saved"
          className={
            tab === "saved"
              ? "font-semibold text-rust underline underline-offset-2"
              : "text-ink-soft underline underline-offset-2 hover:text-rust"
          }
        >
          Saved &amp; tracking ({saveByScholarshipId.size})
        </Link>
      </div>

      <ScholarshipFilterBar
        tab={tab}
        level={level}
        funding={funding}
        within={within}
        field={field}
        q={q}
      />

      {error && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-4 py-3 text-[13.5px] text-rust">
          Couldn&apos;t load scholarships just now — try reloading.
        </p>
      )}

      {!error && scholarships.length === 0 ? (
        <p className="py-12 text-center text-[14.5px] text-ink-soft">
          {tab === "saved"
            ? "Nothing saved yet — tap the bookmark on a scholarship to track it here."
            : "No scholarships match these filters right now — try clearing them."}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {scholarships.map((s) => (
            <ScholarshipCard
              key={s.id}
              scholarship={s}
              save={saveByScholarshipId.get(s.id) ?? null}
              creditsBalance={profile.credits_balance}
              passCovered={passCoverage.covered}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-line pt-3 text-[13px]">
          <span className="text-ink-soft">
            Page {page} of {totalPages} · {total} listing{total === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-4">
            {page > 1 && (
              <a href={buildPageHref(page - 1)} className="font-semibold underline underline-offset-2 hover:text-rust">
                Previous
              </a>
            )}
            {page < totalPages && (
              <a href={buildPageHref(page + 1)} className="font-semibold underline underline-offset-2 hover:text-rust">
                Next
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
