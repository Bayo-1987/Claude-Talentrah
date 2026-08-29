import type { CourseRow } from "./match";

/**
 * The hand-curated catalog, AltSchool Africa only.
 *
 * ONE PROVIDER ON PURPOSE. §6.9 names AltSchool the strongest near-term
 * partner — confirmed programme, and the catalog closest to what a Nigerian
 * job description actually asks for. The plan's reasoning for starting there
 * rather than with three providers is that a matcher proven against one
 * catalog is a matcher; proven against three at once, a wrong result could be
 * the ranking or the data and there is no way to tell which.
 *
 * EVERY URL HERE IS A PLACEHOLDER. §10 item 1: the affiliate accounts are a
 * founder action, not a code change, and the build must not wait on one — the
 * same category as the free-tier Gemini key. The `?ref=talentrah-placeholder`
 * marker is deliberately conspicuous so a real link replacing it is obvious in
 * a diff, and so nobody mistakes these for approved tracking links. They point
 * at real AltSchool programme pages, so a click during M2/M3 development goes
 * somewhere truthful rather than 404ing.
 *
 * `skill_tag` values are drawn from SKILL_VOCABULARY, not invented — a tag
 * outside it can never be produced by the normaliser, so a row carrying one
 * would be dead weight that looks like coverage.
 */

const PLACEHOLDER = "?ref=talentrah-placeholder";

export const ALTSCHOOL_SEED: readonly Omit<CourseRow, "id">[] = [
  {
    skill_tag: "data analysis",
    provider: "altschool",
    title: "AltSchool of Data",
    affiliate_url: `https://altschoolafrica.com/schools/data${PLACEHOLDER}`,
    price_tier: "mid",
  },
  {
    skill_tag: "ui/ux",
    provider: "altschool",
    title: "AltSchool of Product Design",
    affiliate_url: `https://altschoolafrica.com/schools/product-design${PLACEHOLDER}`,
    price_tier: "mid",
  },
  {
    skill_tag: "product management",
    provider: "altschool",
    title: "AltSchool of Product Management",
    affiliate_url: `https://altschoolafrica.com/schools/product-management${PLACEHOLDER}`,
    price_tier: "mid",
  },
  {
    skill_tag: "digital marketing",
    provider: "altschool",
    title: "AltSchool of Digital Marketing (Growth Track)",
    affiliate_url: `https://altschoolafrica.com/schools/marketing${PLACEHOLDER}`,
    price_tier: "low",
  },
  {
    skill_tag: "javascript",
    provider: "altschool",
    title: "AltSchool Frontend Engineering",
    affiliate_url: `https://altschoolafrica.com/schools/engineering/frontend${PLACEHOLDER}`,
    price_tier: "mid",
  },
  {
    skill_tag: "react",
    provider: "altschool",
    title: "AltSchool Frontend Engineering",
    affiliate_url: `https://altschoolafrica.com/schools/engineering/frontend${PLACEHOLDER}`,
    price_tier: "mid",
  },
  {
    skill_tag: "python",
    provider: "altschool",
    title: "AltSchool Backend Engineering (Python)",
    affiliate_url: `https://altschoolafrica.com/schools/engineering/backend${PLACEHOLDER}`,
    price_tier: "mid",
  },
  {
    skill_tag: "sql",
    provider: "altschool",
    title: "AltSchool of Data — SQL Foundations",
    affiliate_url: `https://altschoolafrica.com/schools/data/sql${PLACEHOLDER}`,
    price_tier: "free",
  },
  {
    /*
     * Tagged `aws`, not "cloud engineering". The programme is broader than
     * AWS, but "cloud engineering" is not in SKILL_VOCABULARY, so the
     * normaliser can never produce it and the row would be a course nothing
     * can reach — coverage on paper only. Tagging it to the vocabulary term a
     * JD would actually name is what makes it findable.
     */
    skill_tag: "aws",
    provider: "altschool",
    title: "AltSchool of Cloud Engineering",
    affiliate_url: `https://altschoolafrica.com/schools/cloud${PLACEHOLDER}`,
    price_tier: "mid",
  },
];

/** SQL for the seed, so the catalog can be inserted without an admin UI. */
export function seedInsertSql(): string {
  const values = ALTSCHOOL_SEED.map(
    (c) =>
      `  ('${c.skill_tag.replace(/'/g, "''")}', '${c.provider}', ` +
      `'${c.title.replace(/'/g, "''")}', '${c.affiliate_url}', '${c.price_tier}')`,
  ).join(",\n");
  return `insert into public.course_recommendations (skill_tag, provider, title, affiliate_url, price_tier)\nvalues\n${values}\non conflict (provider, skill_tag, title) do nothing;`;
}
