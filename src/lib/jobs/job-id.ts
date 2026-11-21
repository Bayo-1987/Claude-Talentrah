/**
 * Is this route segment shaped like a job id? A job id is a UUID, and Postgres refuses anything else with 22P02 ("invalid input syntax for type uuid"), which PostgREST turns into a 400.
 * A page that passes a junk segment straight to a query pays for a database call that cannot succeed (production, 20 Nov: `<uuid>&quot` made 16 such calls from four page loads).
 *
 * Deliberately only the SHAPE, any version and variant, either case: this exists to refuse what Postgres would refuse, not to decide which ids are real (a valid id that matches no row is still
 * the page's ordinary 404, after one read). The canonical hyphenated form only: no braces, no unhyphenated form, no surrounding whitespace.
 */
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isJobId(value: string): boolean {
  return JOB_ID.test(value);
}
