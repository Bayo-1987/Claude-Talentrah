import { formatDate } from "@/lib/format/datetime";
import { SITE_ORIGIN } from "@/lib/seo/site";

/**
 * The employer job-list widget's document: a complete, static HTML page for an iframe on a third-party site (plan v2.1, owner-approved 7 Oct 2026).
 *
 * WHAT IT IS NOT. Not a React page and not under the root layout: that layout mounts Vercel Analytics, Speed Insights and the cookie banner, none of which belongs in someone
 * else's iframe. So this builds a string. No script, no form, no button, no external stylesheet, no web font (system fonts), nothing that sets a cookie. Everything printed is
 * escaped, and only the seven public fields the database function returns are ever read: `parseWidgetPayload` copies those and drops every other key, so an applicant count, a
 * description or a salary that somehow arrived in the payload cannot reach the page.
 *
 * ONE NEUTRAL BODY. An unknown, disabled, unverified or QA-owned organisation gets the same "No open jobs right now" page as one with no open job in the neutral case, so the route
 * does not reveal which organisations exist or which are switched on.
 */

export interface WidgetJob {
  id: string;
  title: string;
  location: string | null;
  work_type: string | null;
  employment_type: string | null;
  posted_at: string | null;
}
export interface WidgetData {
  org: { name: string; logo_url: string | null };
  jobs: WidgetJob[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string): boolean => UUID.test(v);

const WORK_TYPE_LABEL: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "Onsite" };
const EMPLOYMENT_TYPE_LABEL: Record<string, string> = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", internship: "Internship" };

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The function's jsonb, checked and reduced to the public fields. Null for anything that is not a usable `{org, jobs}`. */
export function parseWidgetPayload(raw: unknown): WidgetData | null {
  if (!isRecord(raw) || !isRecord(raw.org) || !Array.isArray(raw.jobs)) return null;
  const name = text(raw.org.name);
  if (!name) return null;
  const logo = text(raw.org.logo_url);
  const jobs: WidgetJob[] = [];
  for (const j of raw.jobs) {
    if (!isRecord(j)) continue;
    const id = text(j.id);
    const title = text(j.title);
    if (!id || !UUID.test(id) || !title) continue;
    jobs.push({
      id,
      title,
      location: text(j.location),
      work_type: text(j.work_type),
      employment_type: text(j.employment_type),
      posted_at: text(j.posted_at),
    });
  }
  return { org: { name, logo_url: logo && /^https:\/\//i.test(logo) ? logo : null }, jobs };
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

const CSS = `
*{box-sizing:border-box}
body{margin:0;padding:16px;background:#fbf8f2;color:#2b231d;font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
h1{margin:0;min-width:0;overflow-wrap:anywhere;font:600 19px/1.25 Georgia,"Times New Roman",serif}
header{display:flex;align-items:center;gap:12px;padding-bottom:12px;border-bottom:1.5px solid #2b231d}
header img{width:40px;height:40px;object-fit:contain;flex:none}
ul{list-style:none;margin:0;padding:0}
li{padding:12px 0;border-bottom:1px solid #cbbfae}
a{display:inline-flex;align-items:center;min-height:24px;max-width:100%;overflow-wrap:anywhere;color:#2b231d;text-decoration:underline;text-underline-offset:2px}
a:hover{color:#a4471f}
.t{font:600 16px/1.3 Georgia,"Times New Roman",serif}
.m{margin:2px 0 0;overflow-wrap:anywhere;color:#5b4f44;font-size:13.5px}
.n{margin:16px 0;overflow-wrap:anywhere;color:#5b4f44}
footer{display:flex;flex-wrap:wrap;gap:4px 16px;justify-content:space-between;padding-top:12px;font-size:13px;color:#5b4f44}
footer a{color:inherit}
`.replace(/\n/g, "");

const poweredBy = `<a href="${esc(SITE_ORIGIN)}" target="_blank" rel="noopener">Powered by Talentrah</a>`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

function jobRow(j: WidgetJob): string {
  const meta = [
    j.location,
    j.work_type ? WORK_TYPE_LABEL[j.work_type] : null,
    j.employment_type ? EMPLOYMENT_TYPE_LABEL[j.employment_type] : null,
    j.posted_at ? formatDate(j.posted_at) : null,
  ].filter((m): m is string => !!m && m !== "");
  return `<li><a href="${esc(`${SITE_ORIGIN}/jobs/${j.id}`)}" target="_blank" rel="noopener" class="t">${esc(j.title)}</a>${meta.length ? `<p class="m">${meta.map(esc).join(" · ")}</p>` : ""}</li>`;
}

/** The whole document for a payload, or the neutral one for null. */
export function renderWidgetHtml(data: WidgetData | null): string {
  if (!data) return page("Jobs", `<p class="n">No open jobs right now.</p><footer>${poweredBy}</footer>`);
  const logo = data.org.logo_url ? `<img src="${esc(data.org.logo_url)}" alt="" width="40" height="40" referrerpolicy="no-referrer">` : "";
  const head = `<header>${logo}<h1>Jobs at ${esc(data.org.name)}</h1></header>`;
  const list = data.jobs.length ? `<ul>${data.jobs.map(jobRow).join("")}</ul>` : `<p class="n">No open jobs right now.</p>`;
  const foot = `<footer><a href="${esc(`${SITE_ORIGIN}/jobs`)}" target="_blank" rel="noopener">See all jobs on Talentrah</a>${poweredBy}</footer>`;
  return page(`Jobs at ${data.org.name}`, head + list + foot);
}
