import { createHash } from "node:crypto";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Canonicalization key per build-prompt §6.12: company + title + location. */
export function computeDedupFingerprint(
  companyName: string,
  title: string,
  location: string | undefined,
): string {
  const key = [normalize(companyName), normalize(title), normalize(location ?? "")].join(
    "|",
  );
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
