/**
 * send-500 (PR C) — each Farah quick action gets its own instructions, and every chat prompt carries the
 * rule against inventing the user's achievements.
 *
 * WHAT WENT WRONG (measured, not guessed). The owner clicked Career Advisor ("I'd like some career advice.")
 * and got an interview-prep plan with invented STAR stories ("Validated $2 M TAM; secured $500k budget",
 * "15 pilot merchants", a tool name) presented as theirs. Production's own rows show why the plan was
 * interview-shaped: the turn immediately before that click was an Interview Prep quick action, and
 * `chat/route.ts` replays the last six turns while the system prompt is identical for every entry point. The
 * route stored `quickAction` in `context` for the transcript and never gave it to the model. So a quick action
 * was only ever the starter text, and a vague starter continues whatever the history is about.
 *
 * WHAT THESE PIN. The prompt the model actually receives, per action: its own instructions, a statement that it
 * is a NEW request (so an earlier topic is not continued), and the placeholder rule. They cannot judge model
 * output (no model runs here); they pin that the instructions are present and distinct, which is the part this
 * code controls. The module does not exist when this file is first committed, so it is loaded at runtime.
 */
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";
import { FARAH_QUICK_ACTIONS } from "@/lib/farah/quick-actions";
import { FARAH_SYSTEM_PROMPT } from "@/lib/farah/system-prompt";
import { JOB_FIT_ENTRY_POINT } from "@/lib/farah/job-seed";

interface ChatPrompt {
  buildFarahChatSystemPrompt(opts?: { quickAction?: string; extraContext?: string }): string;
  quickActionInstructions(key: string): string | undefined;
}
const load = () => loadModule<ChatPrompt>("@/lib/farah/chat-prompt");

const CHAT_ACTIONS = FARAH_QUICK_ACTIONS.filter((a) => a.starterPrompt);

describe("each quick action has its own instructions", () => {
  it("every chat quick action has non-empty instructions", async () => {
    const { quickActionInstructions } = await load();
    for (const a of CHAT_ACTIONS) {
      expect(quickActionInstructions(a.key), `no instructions for ${a.key}`).toBeTruthy();
    }
  });

  it("the instructions are different from one another", async () => {
    const { quickActionInstructions } = await load();
    const texts = CHAT_ACTIONS.map((a) => quickActionInstructions(a.key));
    expect(new Set(texts).size).toBe(CHAT_ACTIONS.length);
  });

  it("each prompt carries its own action's instructions and none of the others'", async () => {
    const { buildFarahChatSystemPrompt, quickActionInstructions } = await load();
    for (const a of CHAT_ACTIONS) {
      const prompt = buildFarahChatSystemPrompt({ quickAction: a.key });
      expect(prompt, `${a.key} prompt lacks its own instructions`).toContain(quickActionInstructions(a.key)!);
      for (const other of CHAT_ACTIONS.filter((o) => o.key !== a.key)) {
        expect(prompt, `${a.key} prompt leaks ${other.key}'s instructions`).not.toContain(quickActionInstructions(other.key)!);
      }
    }
  });

  it("REGRESSION (the reported bug): the Career Advisor prompt is not an interview-prep prompt", async () => {
    const { buildFarahChatSystemPrompt, quickActionInstructions } = await load();
    const prompt = buildFarahChatSystemPrompt({ quickAction: "career-advisor" });
    expect(prompt).not.toContain(quickActionInstructions("interview-prep")!);
    expect(prompt).toMatch(/career advice/i);
    // The prompt must say this is a new request, so an earlier interview thread in the replayed history is
    // not continued. This is the instruction that addresses the history, which the owner's case turned on.
    expect(prompt).toMatch(/new (request|topic)/i);
    expect(prompt).toMatch(/(do not|don't) continue/i);
  });

  it("without a quick action the prompt is the shared one plus the shared rules, with no per-action block", async () => {
    const { buildFarahChatSystemPrompt, quickActionInstructions } = await load();
    const prompt = buildFarahChatSystemPrompt();
    expect(prompt.startsWith(FARAH_SYSTEM_PROMPT)).toBe(true);
    for (const a of CHAT_ACTIONS) expect(prompt).not.toContain(quickActionInstructions(a.key)!);
  });

  it("an unknown quick action key adds nothing (and does not throw)", async () => {
    const { buildFarahChatSystemPrompt } = await load();
    expect(buildFarahChatSystemPrompt({ quickAction: "no-such-action" })).toBe(buildFarahChatSystemPrompt());
  });

  it("extra context (the resume grounding) is still appended, after the instructions", async () => {
    const { buildFarahChatSystemPrompt, quickActionInstructions } = await load();
    const prompt = buildFarahChatSystemPrompt({ quickAction: "career-advisor", extraContext: "GROUNDING-LINE" });
    expect(prompt).toContain("GROUNDING-LINE");
    expect(prompt.indexOf("GROUNDING-LINE")).toBeGreaterThan(prompt.indexOf(quickActionInstructions("career-advisor")!));
  });
});

describe("the rule against inventing the user's achievements, in every chat prompt", () => {
  const surfaces: Array<[string, string | undefined]> = [
    ["free text", undefined],
    ...CHAT_ACTIONS.map((a): [string, string | undefined] => [a.label, a.key]),
    ["job fit (the Ask Farah starters)", JOB_FIT_ENTRY_POINT],
  ];

  for (const [name, key] of surfaces) {
    it(`${name}: forbids inventing achievements, metrics, employers and tools, and says to use [your metric] placeholders`, async () => {
      const { buildFarahChatSystemPrompt } = await load();
      const prompt = buildFarahChatSystemPrompt({ quickAction: key });
      expect(prompt).toMatch(/never (invent|make up|fabricate)/i);
      expect(prompt).toContain("[your metric]");
      // The reported cases, by kind: a figure, a count of people/clients, a named tool.
      expect(prompt).toMatch(/number|figure|metric/i);
      expect(prompt).toMatch(/(example|story|stories|achievement)/i);
    });
  }

  it("treats an example the user did not give as a template to fill in, not a claim about the user", async () => {
    const { buildFarahChatSystemPrompt } = await load();
    const prompt = buildFarahChatSystemPrompt({ quickAction: "interview-prep" });
    expect(prompt).toMatch(/template|placeholder/i);
    expect(prompt).toMatch(/(not|never) (as|present).*(yours|theirs|the user's)|as if (it|they) (were|are) (theirs|the user's|yours)/i);
  });
});

describe("a reply is sized for the panel, so it does not hit the output ceiling", () => {
  it("the chat prompt asks for a short reply and to offer to continue, rather than one long document", async () => {
    const { buildFarahChatSystemPrompt } = await load();
    const prompt = buildFarahChatSystemPrompt();
    expect(prompt).toMatch(/short|brief|concise/i);
    expect(prompt).toMatch(/continue/i);
  });
});
