/**
 * Synthetic scholarship text for the reviewer-commentary check (#704). Made up on purpose: "Example University", "Example Scholarship", invented dates,
 * and none of any real listing's details, sourcing process or tooling. Each field below trips exactly ONE trigger phrase, so removing a phrase from the shared
 * list makes the field stop being flagged and the matching mutation test fail.
 */
export const EXAMPLE_COMMENTARY_ROW = {
  provider: "Example Foundation",
  program_name: "Example Scholarship",
  host_institution: "Example University",
  field_tags: ["engineering"],
  funding_covers: ["tuition"],
  eligibility_nationalities: ["Nigeria"],
  // The unconfirmed-deadline remark, with a straight quote and extra spaces inside the phrase.
  deadline_note: 'Reported as "Friday, 1 May 2026". A human   should open the link and confirm this date.',
  // The "not independently confirmed" remark, written with a curly apostrophe elsewhere in the sentence.
  eligibility_prior_degree: "A bachelor’s degree. (Reported by secondary sources; NOT independently confirmed.)",
  // The "not machine-verified" remark, with the hyphen as a non-breaking hyphen.
  eligibility_age: "Under 30 on 1 May 2026. Not machine‑verified against the official form.",
  // The "needs a human to confirm" remark.
  eligibility_other: "Fully funded two-year master's at Example University. Everything below this line needs a human to confirm on the official form.",
  // The "see moderation_note" pointer.
  source_name: "Example University application form (see moderation_note)",
} as const;

/** Phrase → the one column of EXAMPLE_COMMENTARY_ROW that only that phrase flags. */
export const PHRASE_TO_FIELD: Record<string, keyof typeof EXAMPLE_COMMENTARY_ROW> = {
  "a human should": "deadline_note",
  "not independently confirmed": "eligibility_prior_degree",
  "not machine-verified": "eligibility_age",
  "needs a human to confirm": "eligibility_other",
  "see moderation_note": "source_name",
};

/** Text that must NEVER be flagged: provenance, and everyday words that share a word with a trigger. */
export const LEGITIMATE_CORPUS: Array<{ column: string; text: string }> = [
  { column: "eligibility_other", text: "Officially confirmed (fetched 2026-09-09 from the Example University application form): a fully funded two-year master's degree." },
  { column: "eligibility_other", text: "Open to journalists and authors: submit your work before publishing it elsewhere." },
  { column: "eligibility_other", text: "Awarded for publishing in a peer-reviewed journal; a reviewer panel scores each entry." },
  { column: "eligibility_other", text: "A pass/fail grade on the foundation year is accepted. Applicants must pass an English test." },
  { column: "eligibility_other", text: "The national registry could not confirm every transcript, so a certified copy is required." },
  { column: "eligibility_other", text: "Use your Talentrah Pass credits to draft the personal statement; this pass covers one tailoring." },
  { column: "deadline_note", text: "Varies by partner institution. See the official source for your chosen university." },
  { column: "deadline_note", text: "Closes at 1pm Pacific Time on the deadline day." },
  { column: "eligibility_prior_degree", text: "Bachelor's degree with a human-rights, law or social-science focus." },
  { column: "source_name", text: "Example University official application form" },
];
