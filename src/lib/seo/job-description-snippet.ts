/**
 * Strips a leading, redundant "Job Title: X / Type: Y / Location: Z" header
 * some raw job descriptions open with, before a meta-description snippet is
 * cut from them.
 *
 * MEASURED, NOT ASSUMED, AND NARROWER THAN THE SYMPTOM SUGGESTED. Sampled
 * against production directly (2026-09-18): only 4 of 704 open postings
 * carry this exact shape, and every one of them is `external_source =
 * schema-org:workable-south-africa` — but that is two individual employers'
 * own ad-copy style (Optimal Group's "JOB TITLE:.../LOCATION:.../TERMS:...",
 * the Law Offices of Sabrina Li's "Job Title:.../Type:.../**Location:..."),
 * not a per-source formatting convention. The other ~115 postings sourced
 * through the same Workable pipeline, and all 387 Greenhouse-sourced ones
 * sampled, carry no such header at all. That rules out an ingest-level,
 * per-source normalization step (`src/lib/jobs/sources/`) as the right
 * layer — there is no one source whose *format* this is, only a shape any
 * employer on any ATS could type into their own free-text ad body. A
 * snippet-level strip, applied uniformly regardless of source, is correct;
 * an ingest-level fix would be solving a problem that source doesn't
 * actually have.
 *
 * SCOPED EXACTLY TO JOB TITLE/TYPE/LOCATION, NOT A GENERAL "KEY: VALUE"
 * CLEANER. Those three duplicate what `generateMetadata`'s own `lead`
 * already states (title, company, location) or is otherwise redundant
 * boilerplate; other fields real postings sometimes lead with (TERMS,
 * SALARY) are new information, not restated, so they are deliberately left
 * alone — stripping only stops once the run hits something outside this
 * three-label set.
 */

/** The three labels this strip recognises — job title, employment type,
 * location — matched at the very start of the (already whitespace-collapsed)
 * description, case-insensitively, tolerating a leading markdown `**` some
 * postings bold their labels with. */
const LEADING_LABEL = /^\**\s*(?:job title|type|location)\s*:\s*/i;

/**
 * Where one label's own value ends: the next recognised label (so the loop
 * can keep going), any OTHER short "Word:" field (TERMS, SALARY, ...), or a
 * common section header with no colon at all ("About Us"). Never open-ended
 * — a label whose value runs into ordinary prose with none of these markers
 * is left alone rather than guessed at, the same "emit/strip nothing rather
 * than something wrong" instinct `job-posting-jsonld.ts` uses for markup.
 */
const NEXT_BOUNDARY = /\**\s*(?:[A-Z][a-zA-Z]{1,20}:|About\s+Us\b)/;

/** Hard cap on iterations — three real labels can repeat at most a handful
 * of times; this only exists so adversarial input can't loop unbounded. */
const MAX_LABELS = 6;

export function stripRedundantJobHeader(text: string): string {
  let rest = text;
  let strippedAny = false;

  for (let i = 0; i < MAX_LABELS; i++) {
    const label = rest.match(LEADING_LABEL);
    if (!label) break;

    const value = rest.slice(label[0].length);
    const boundary = value.search(NEXT_BOUNDARY);
    if (boundary === -1) break; // no safe place to cut — leave the rest untouched

    rest = value.slice(boundary);
    strippedAny = true;
  }

  return strippedAny ? rest.trimStart() : text;
}
