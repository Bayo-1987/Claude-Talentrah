/**
 * A1 (S3-66): a chip needed four things in four places (the chip list, its per-chip instruction, the keys the route accepts, and the entry points the
 * database allows). One registry now feeds all four, and this file fails if any chip is missing from any consumer. The "throws at import if a chip
 * has no instruction" behaviour is kept. The module does not exist when this file is first committed, so it is loaded at runtime.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";
import { FARAH_QUICK_ACTIONS } from "@/lib/farah/quick-actions";
import { buildFarahChatSystemPrompt, quickActionInstructions } from "@/lib/farah/chat-prompt";
import { JOB_FIT_ENTRY_POINT } from "@/lib/farah/job-seed";

interface Chip {
  key: string;
  label: string;
  starterPrompt: string | null;
  surface: "panel" | "job-seed";
  entryPoint: string;
  instruction: string;
}
interface Registry {
  FARAH_CHIPS: readonly Chip[];
  chipEntryPoint(key: string | undefined): string;
  isChatChip(key: string | undefined): boolean;
}
const load = () => loadModule<Registry>("@/lib/farah/chip-registry");

/** The entry points the DATABASE allows: the newest migration that defines the check constraint wins. */
function allowedEntryPoints(): string[] {
  const dir = "supabase/migrations";
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let allowed: string[] = [];
  for (const f of files) {
    const sql = readFileSync(`${dir}/${f}`, "utf8");
    const m = sql.match(/add constraint farah_session_events_entry_point_check check \(\s*entry_point in \(([^)]*)\)/i);
    if (m) allowed = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }
  return allowed;
}

describe("the chip registry feeds every consumer", () => {
  it("the panel's quick actions are the registry's panel chips, in the same order, with the same fields as today", async () => {
    const { FARAH_CHIPS } = await load();
    const panel = FARAH_CHIPS.filter((c) => c.surface === "panel").map(({ key, label, starterPrompt }) => ({ key, label, href: null, starterPrompt }));
    expect(FARAH_QUICK_ACTIONS).toEqual(panel);
    // pinned as TODAY's three chips, so a registry edit cannot silently change what every page shows
    expect(FARAH_QUICK_ACTIONS.map((a) => [a.key, a.label, a.starterPrompt])).toEqual([
      ["interview-prep", "Job Interview Prep", "Help me prep for a job interview."],
      ["career-advisor", "Career Advisor", "I'd like some career advice."],
      ["salary-negotiation", "Salary Negotiation", "I want to prep for a salary negotiation."],
    ]);
  });

  it("EVERY chip has a non-empty instruction that reaches the prompt builder", async () => {
    const { FARAH_CHIPS } = await load();
    expect(FARAH_CHIPS.length).toBeGreaterThanOrEqual(4);
    for (const c of FARAH_CHIPS) {
      expect(c.instruction.trim().length, `${c.key} has no instruction`).toBeGreaterThan(0);
      expect(quickActionInstructions(c.key), `${c.key} instruction is missing from chat-prompt`).toBe(c.instruction);
      expect(buildFarahChatSystemPrompt({ quickAction: c.key })).toContain(c.instruction);
    }
  });

  it("EVERY chip key is one the route accepts as a chat entry point; an unknown key is not", async () => {
    const { FARAH_CHIPS, isChatChip } = await load();
    for (const c of FARAH_CHIPS) expect(isChatChip(c.key), `${c.key} is not accepted by the route`).toBe(true);
    expect(isChatChip("no-such-chip")).toBe(false);
    expect(isChatChip(undefined)).toBe(false);
    // and the route really uses it: it no longer carries its own hand-written list of keys
    const route = readFileSync("src/app/api/farah/chat/route.ts", "utf8");
    expect(route).not.toMatch(/new Set\(\[\s*"interview-prep"/);
  });

  it("EVERY chip's entry point is allowed by the database check constraint (the newest migration that defines it)", async () => {
    const { FARAH_CHIPS, chipEntryPoint } = await load();
    const allowed = allowedEntryPoints();
    expect(allowed, "could not read the constraint from the migrations").toContain("free_text");
    for (const c of FARAH_CHIPS) {
      expect(allowed, `${c.key} logs as ${c.entryPoint}, which the database would reject`).toContain(c.entryPoint);
      expect(chipEntryPoint(c.key)).toBe(c.entryPoint);
    }
    expect(chipEntryPoint(undefined)).toBe("free_text");
    expect(chipEntryPoint("no-such-chip")).toBe("free_text");
  });

  it("keys are unique, and the job-fit chip is the existing key", async () => {
    const { FARAH_CHIPS } = await load();
    const keys = FARAH_CHIPS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain(JOB_FIT_ENTRY_POINT);
    expect(JOB_FIT_ENTRY_POINT).toBe("job_fit");
  });

  it("a chip with no instruction makes the prompt module throw at import (kept from before)", async () => {
    const { validateChips } = await loadModule<{ validateChips(chips: unknown[]): void }>("@/lib/farah/chip-registry");
    expect(() => validateChips([{ key: "x", label: "X", starterPrompt: "p", surface: "panel", entryPoint: "free_text", instruction: "" }])).toThrow(/no instruction/);
    expect(() => validateChips([{ key: "x", label: "X", starterPrompt: "p", surface: "panel", entryPoint: "free_text", instruction: "ok" }])).not.toThrow();
  });
});
