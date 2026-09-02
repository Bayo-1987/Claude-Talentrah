import { createHash } from "node:crypto";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reduces a location string to the one segment most likely to agree across
 * TWO DIFFERENT SOURCES describing the same real place in different amounts
 * of detail — src/lib/jobs/sources/greenhouse.ts stores whatever free text
 * the employer typed into their own board ("Lagos", "Lagos, Nigeria",
 * "Remote - Lagos, Nigeria" all appear in real production data — see
 * job-posting-jsonld.ts's parseJobLocation for the measured list), while
 * src/lib/jobs/sources/schema-org.ts's formatLocation always produces a
 * structured "Locality, Region, Country" join with no "Remote" prefix.
 *
 * Founder requirement: the SAME real job must not appear twice because one
 * source stated its location more precisely than another — a company that
 * runs its own Greenhouse board AND happens to also be indexed by a Workable
 * country search (or a role that legitimately gets posted to two ATSs) must
 * collapse to one row, not two.
 *
 * "Remote" is stripped first as a MODIFIER, not a place — matching
 * parseJobLocation's own established rule — because it can lead either
 * source's string ("Remote - Lagos, Nigeria" from an employer; schema-org
 * never prefixes it, since work_type already carries remote-ness
 * separately). The FIRST remaining segment is kept: the city, when one is
 * stated, because a Greenhouse entry commonly omits the country ("Lagos"
 * alone, unrecoverable from the other direction), while both sources
 * virtually always agree on the city whenever either states one.
 *
 * NOT A GAZETTEER, deliberately — no list of place names, just a positional
 * split on the punctuation both sources already use as a separator. That is
 * the same reason parseJobLocation rejects a curated country list: a
 * hand-maintained lookup goes stale silently, a positional rule does not.
 *
 * WHAT THIS DOES NOT SOLVE, named rather than implied: a Greenhouse entry
 * that leads with something other than the city ("Nigeria (Remote)",
 * country-first) still won't match a city-first schema-org value. Real
 * production location data measured for this same repo skews city-first
 * ("Lagos, Nigeria", "Lagos", "Remote, Lagos, Nigeria" all lead with the
 * city or with a bare "Remote"), so this closes the common case rather than
 * claiming to close every possible free-text ordering — the honest bar
 * job-posting-jsonld.ts already holds itself to for the same class of data.
 */
function canonicalLocationToken(location: string): string {
  const segments = location
    .split(/[,\-–—]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return "";
  const first = segments[0]!.toLowerCase() === "remote" ? segments[1] : segments[0];
  return first ?? "";
}

/**
 * Canonicalization key per build-prompt §6.12: company + title + location.
 *
 * ── THE LOCATION COMPONENT CHANGED — WHAT THAT MEANS FOR EXISTING ROWS ─────
 *
 * This used to hash the location string in full; it now hashes
 * `canonicalLocationToken`'s reduction of it (see that function for why).
 * `dedup_fingerprint` is a stable identity an upsert relies on to UPDATE an
 * existing row rather than create a new one, so changing how it's computed
 * is a one-time identity change for every currently-open EXTERNAL posting
 * whose location has more than one segment: the next ingest run computes a
 * fingerprint that no longer matches what's stored, upserts a fresh row
 * under the new one, and the freshness sweep — finding the OLD fingerprint
 * absent from that run's freshly-computed seen set — closes the old row in
 * the same run. One clean transition, not indefinite duplication, and nothing
 * a migration needs to touch by hand.
 *
 * The real cost is narrower and worth naming plainly: a seeker who saved or
 * applied to one of those affected postings has that record pointing at the
 * OLD row, which closes; the surviving row is a fresh id with no memory of
 * their save/apply. Internal postings are entirely unaffected — employer
 * postings key on `internalDedupFingerprint` in src/lib/employer/actions.ts,
 * a separate function this change does not touch — as are single-segment
 * locations ("Lagos" alone, "Remote" alone), whose canonical token is
 * identical to their old normalized form.
 */
export function computeDedupFingerprint(
  companyName: string,
  title: string,
  location: string | undefined,
): string {
  const key = [
    normalize(companyName),
    normalize(title),
    normalize(canonicalLocationToken(location ?? "")),
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Makes a colliding fingerprint unique to one posting.
 *
 * WHEN THIS IS USED, AND WHY IT IS NARROW. Only when two postings IN THE SAME
 * FETCH canonicalize identically. Within one source that means two separate
 * requisitions — the source itself distinguishes them, by URL — so they are
 * different jobs and must not collapse into one row. Across sources an
 * identical canonical key means the same job, which SHOULD collapse; that is
 * the whole point of the fingerprint and this function never runs there,
 * because a fetch only ever contains one source's postings.
 *
 * THE TRADE-OFF, stated because it is a real one. Disambiguating means that if
 * a board genuinely lists one role twice (the case `ingest.ts`'s original
 * comment cites — "duplicate postings across teams"), the feed now shows two
 * entries instead of one. That is a quality cost. It is accepted because the
 * alternative is losing an apply link: a duplicate is an annoyance a seeker can
 * see and ignore, while a dropped posting is a job they never learn exists, and
 * a surviving-but-wrong URL sends them to a requisition they did not choose.
 * Wrong-and-invisible beats annoying-and-visible only if you never have to
 * explain it to the person who missed the job.
 *
 * The URL rather than an index: stable across runs, so a posting keeps the same
 * fingerprint on every ingest and the upsert updates it instead of inserting a
 * new row each time.
 */
export function disambiguateFingerprint(fingerprint: string, externalUrl: string): string {
  return createHash("sha256").update(`${fingerprint}|${externalUrl}`).digest("hex");
}
