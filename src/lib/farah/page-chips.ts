import { FARAH_CHIPS, type FarahChip, type FarahPageKey } from "./chip-registry";

/**
 * Page-aware chips: which chips (and which one-line opening line) the docked panel shows on which route, and which ids that route carries. Client-safe, pure, table-driven.
 *
 * A route that is NOT in ROUTES gets exactly today's three panel chips and keeps the panel's own greeting: a sibling or a child of a listed route, a route with a malformed id, a route missing its query: all unlisted.
 * A listed route gets exactly its page's chips (from the registry, `surface: "page"`) and the opening line below; a chip that needs an id (a job, a scholarship, an application) is shown only where the route carries
 * one. The opening lines promise nothing the page does not do. tests/farah/page-chips.test.ts pins every row and pins the unlisted routes against literals.
 *
 * The ids read here are only SELECTORS: the server never trusts one. The chat route validates each as a uuid and loads the record through the signed-in user's own access (page-facts.ts).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PageContext {
  jobId?: string;
  scholarshipId?: string;
  applicationId?: string;
}

interface Match {
  page: FarahPageKey;
  ids: PageContext;
}

/** Strips a fragment and one trailing slash. (A query in the path is dropped too: the query is passed separately.) */
function normalise(pathname: string | null | undefined): string {
  const bare = (pathname ?? "").split(/[?#]/)[0];
  return bare.length > 1 && bare.endsWith("/") ? bare.slice(0, -1) : bare;
}

function paramsOf(search: string | URLSearchParams | null | undefined): URLSearchParams {
  if (search instanceof URLSearchParams) return search;
  return new URLSearchParams(search ?? "");
}

const isId = (s: string | undefined): s is string => s !== undefined && UUID.test(s);

function matchRoute(path: string, params: URLSearchParams): Match | null {
  const seg = path.split("/").filter(Boolean);
  const [a, b, c, d] = seg;
  if (seg.length === 1 && a === "billing") return { page: "billing", ids: {} };
  if (a === "jobs") {
    if (seg.length === 1) return { page: "jobs", ids: {} };
    if (seg.length === 2 && isId(b)) return { page: "jobs", ids: { jobId: b } };
    return null;
  }
  if (a === "scholarships") {
    if (seg.length === 1) return { page: "scholarships", ids: {} };
    if (seg.length === 2 && isId(b)) return { page: "scholarships", ids: { scholarshipId: b } };
    return null;
  }
  if (a === "resume-builder") {
    if (seg.length === 1 || (seg.length === 2 && b === "edit")) return { page: "resume-builder", ids: {} };
    return null;
  }
  if (seg.length === 1 && a === "tailor") {
    const jobId = params.get("jobId") ?? undefined;
    return isId(jobId) ? { page: "tailor", ids: { jobId } } : null;
  }
  if (a === "tracker") {
    if (seg.length === 1) return { page: "tracker", ids: {} };
    if (seg.length === 3 && isId(b) && c === "sent") return { page: "tracker", ids: { applicationId: b } };
    return null;
  }
  if (seg.length === 1 && a === "auto-apply") return { page: "auto-apply", ids: {} };
  if (a === "mentorship") {
    if (seg.length === 1) return { page: "mentorship", ids: {} };
    if (seg.length === 2 && isId(b)) return { page: "mentorship", ids: {} };
    return null;
  }
  if (seg.length === 2 && a === "talent-directory" && b === "verify") return { page: "talent-directory", ids: {} };
  if (seg.length === 1 && a === "refer") return { page: "refer", ids: {} };
  void d;
  return null;
}

const OPENING_LINES: Record<FarahPageKey, string> = {
  billing: "Ask me what your credits can do, which pack or pass might suit you, or what's free.",
  jobs: "Looking at your matches? Ask me why a job fits, or what's missing.",
  scholarships: "Choosing a scholarship? I can help you pick one and plan your statement.",
  "resume-builder": "Working on your resume? I can point at what to improve.",
  tailor: "Pasted a job? I can tell you what it wants that your resume doesn't show yet.",
  tracker: "Keeping track of applications? I can tell you which ones are worth a follow-up.",
  "auto-apply": "Wondering what Auto-Apply will do with a match? Ask me. Nothing is applied until you confirm.",
  mentorship: "Thinking about a mentor? Ask me how to choose and what to bring.",
  "talent-directory": "Thinking about joining the Talent Directory? I can explain what the review involves.",
  refer: "Want to invite someone? I can explain how Refer & Earn works.",
};

export function farahPageKeyForPath(pathname: string | null | undefined, search?: string | URLSearchParams | null): FarahPageKey | null {
  return matchRoute(normalise(pathname), paramsOf(search))?.page ?? null;
}

/** The ids this route carries (a job, a scholarship, an application), for the click to send along. Empty on an unlisted route. */
export function pageContextForPath(pathname: string | null | undefined, search?: string | URLSearchParams | null): PageContext {
  return matchRoute(normalise(pathname), paramsOf(search))?.ids ?? {};
}

export interface PanelChips {
  chips: ReadonlyArray<Pick<FarahChip, "key" | "label" | "starterPrompt" | "page" | "facts" | "needs">>;
  /** A one-line opening line for this page, or null: the panel keeps its own greeting. */
  openingLine: string | null;
}

export function panelChipsForPath(pathname: string | null | undefined, search?: string | URLSearchParams | null): PanelChips {
  const match = matchRoute(normalise(pathname), paramsOf(search));
  if (match) {
    return {
      chips: FARAH_CHIPS.filter((c) => c.surface === "page" && c.page === match.page && (c.needs === undefined || match.ids[c.needs] !== undefined)),
      openingLine: OPENING_LINES[match.page],
    };
  }
  return { chips: FARAH_CHIPS.filter((c) => c.surface === "panel"), openingLine: null };
}
