/**
 * How "Ask Farah" on a job reaches the panel and what it does there (a source check: this project's unit environment has no DOM, so the real round trip is e2e/farah-job-context-visible.spec.ts). Three promises are held here
 * because each can be broken by deleting one line, and a deleted line shows nowhere else:
 *   - the click and the arrival SEND NOTHING: no message, no fetch, no use of one of the reader's free messages. The job reaches Farah only when the reader chooses an option;
 *   - the panel visibly responds: it reveals the new block (scroll and focus) and announces it, every time a job arrives, including the same job again;
 *   - both arrival paths render the one block component.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync("src/components/app-shell/farah-panel.tsx", "utf8");
const menu = readFileSync("src/components/jobs/farah-job-menu.tsx", "utf8");
const seed = readFileSync("src/lib/farah/job-seed.ts", "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** The text of the `onFarahJobSeed((seed) => { ... })` handler, up to its closing `}),`. */
function seedHandler(): string {
  const start = panel.indexOf("onFarahJobSeed((seed) => {");
  expect(start, "the panel no longer subscribes to onFarahJobSeed").toBeGreaterThan(-1);
  const end = panel.indexOf("\n    });\n    return () => {", start);
  expect(end).toBeGreaterThan(start);
  return code(panel.slice(start, end));
}

describe("the click and the arrival send nothing", () => {
  it("the job card's button only announces the job and scrolls the panel into view", () => {
    const body = code(menu);
    expect(body).toContain("seedFarahForJob({ jobId, jobTitle, companyName });");
    expect(body).toContain("scrollToFarahPanel();");
    expect(body).not.toMatch(/\bfetch\s*\(|sendOrPrefill|\bsend\s*\(|onStarter|\/api\/farah/);
  });
  it("seedFarahForJob is a window event and nothing more", () => {
    const fn = code(seed.slice(seed.indexOf("export function seedFarahForJob")));
    expect(fn).toContain("window.dispatchEvent(new CustomEvent<FarahJobSeed>(FARAH_JOB_SEED_EVENT");
    expect(fn.slice(0, fn.indexOf("}\n") + 1)).not.toMatch(/\bfetch\s*\(|\/api\//);
  });
  it("the panel's handler for the arriving job only sets what is shown: it sends and fetches nothing", () => {
    const handler = seedHandler();
    expect(handler.length).toBeGreaterThan(200);
    expect(handler).not.toMatch(/\bfetch\s*\(|sendOrPrefill|\bsend\s*\(|onStarter|setPending|setMessages/);
  });
  it("the arrival effect (reveal and announce) sends and fetches nothing either", () => {
    const start = panel.indexOf("revealJobBlock(");
    expect(start, "the panel no longer reveals the job block").toBeGreaterThan(-1);
    const effect = code(panel.slice(panel.lastIndexOf("useEffect(", start), panel.indexOf("\n  }, [", start) + 12));
    expect(effect).not.toMatch(/\bfetch\s*\(|sendOrPrefill|\bsend\s*\(|onStarter|setMessages/);
  });
  it("the only calls that send a chat message stay where they were: the starters' onStarter and the quick-action chips", () => {
    const sends = code(panel).match(/\b(?:void )?send\(|sendOrPrefill\(/g) ?? [];
    // send() definition, the submit path, the quick-action chip, sendOrPrefill()'s own send, its definition, and the three onStarter / chip prefills
    expect(sends.length).toBe(10);
    expect(code(panel).match(/fetch\(/g)).toHaveLength(2); // the history fetch and the chat request, as before
  });
});

describe("the panel responds when a job arrives", () => {
  it("counts every arrival, the same job again included, and the reveal effect depends on that count", () => {
    expect(panel).toMatch(/const \[seedArrival, setSeedArrival\] = useState<\{ seed: FarahJobSeed \} \| null>\(null\)/);
    expect(seedHandler()).toContain("setSeedArrival({ seed })");
    expect(panel).toMatch(/revealJobBlock\(latestBlockRef\.current, prefersReducedMotion\(\)\);\s*\}, \[seedArrival\]\)/);
  });
  it("reveals the newest block (scroll and focus) and respects the reader's reduced-motion setting", () => {
    expect(panel).toMatch(/revealJobBlock\(latestBlockRef\.current, prefersReducedMotion\(\)\)/);
  });
  it("announces the job in the polite live region, after clearing it so a repeat is announced again", () => {
    const handler = seedHandler();
    expect(handler).toContain('setAnnouncement("")');
    expect(handler).toMatch(/setTimeout\(\(\) => setAnnouncement\(jobSeedAnnouncement\(seed\)\), \d+\)/);
    expect(panel).toMatch(/<p role="status" aria-live="polite" className="sr-only">/);
  });
  it("a job clicked again is not hidden by the 'same job as the last divider' rule once the conversation has moved on", () => {
    expect(seedHandler()).toMatch(/last\.seed\.jobId === seed\.jobId && last\.insertAt === currentLength/);
  });
});

describe("one block for every arrival path", () => {
  it("the pristine panel and both marker positions render JobSeedBlock; the old JobSeedMarker is gone", () => {
    expect(panel.match(/<JobSeedBlock/g)?.length).toBe(3);
    expect(panel).not.toMatch(/\bJobSeedMarker\b/);
  });
  it("the dividers are only drawn in a conversation that already has content", () => {
    expect(panel.match(/withDivider/g)?.length).toBeGreaterThanOrEqual(3);
    expect(panel).toMatch(/withDivider=\{false\}|withDivider=\{true\}/);
  });
});
