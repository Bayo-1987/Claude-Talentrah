import path from "node:path";
import { run, type Pull } from "./handoff-fill-merge-facts-core";

/**
 * Fills the merge facts that docs/handoff entries could not quote about themselves (see handoff-fill-merge-facts-core.ts).
 *
 *   npm run handoff-fill-merge-facts                 dry run: prints the diff, writes nothing
 *   npm run handoff-fill-merge-facts -- --write      applies it
 *
 * Read-only against GitHub: every request is a GET of /repos/:owner/:repo/pulls/:n. GITHUB_TOKEN is used when set (higher rate
 * limit); GITHUB_REPOSITORY overrides the repository. Meant to be run periodically and the result committed as a docs-only PR.
 */
const REPO = process.env.GITHUB_REPOSITORY ?? "Bayo-1987/Claude-Talentrah";

async function getPull(pr: number): Promise<Pull> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "handoff-fill-merge-facts" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${REPO}/pulls/${pr}`, { method: "GET", headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} for pulls/${pr}`);
  return (await res.json()) as Pull;
}

run(process.argv.slice(2), { dir: path.join(process.cwd(), "docs/handoff"), getPull, out: (s) => console.log(s) }).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
