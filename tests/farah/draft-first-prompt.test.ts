/**
 * Long writing requests ("write me 500 words about…") used to spend a free message just to get questions back.
 *
 * Two reasons, both in the prompt the model receives: the reply-size rule asked for under about 200 words, which pushes a 500-word
 * request toward a short reply, and nothing said what to do when details are missing, so the model asked. The free allowance counts a
 * completed reply whatever it says, so a questions-only reply used one up for nothing.
 *
 * What changes: Farah drafts first, with [square-bracket placeholders] for what she does not know and at most three things to fill in; she asks a
 * question instead only when no useful draft is possible, and then exactly one; and an explicit length request is exempt from the 200-word rule.
 *
 * These pin the prompt the model actually receives (no model runs here), the same way quick-action-prompts.test.ts does.
 */
import { describe, expect, it } from "vitest";
import { buildFarahChatSystemPrompt, DRAFT_FIRST_RULE, NO_INVENTED_ACHIEVEMENTS_RULE, REPLY_SIZE_RULE } from "@/lib/farah/chat-prompt";
import { FARAH_QUICK_ACTIONS } from "@/lib/farah/quick-actions";
import { JOB_FIT_ENTRY_POINT } from "@/lib/farah/job-seed";
import { quickActionInstructions } from "@/lib/farah/chat-prompt";

const ENTRY_POINTS = [undefined, ...FARAH_QUICK_ACTIONS.filter((a) => a.starterPrompt).map((a) => a.key), JOB_FIT_ENTRY_POINT];

describe("draft first, with placeholders", () => {
  it("the rule exists and says to draft instead of replying with questions alone", () => {
    expect(DRAFT_FIRST_RULE, "DRAFT_FIRST_RULE must be exported from chat-prompt.ts").toBeTypeOf("string");
    expect(DRAFT_FIRST_RULE).toMatch(/write the draft/i);
    expect(DRAFT_FIRST_RULE).toMatch(/not (reply|respond) with questions alone|never (reply|respond) with questions alone/i);
  });

  it("missing details become [square-bracket placeholders], with at most three things to fill in", () => {
    expect(DRAFT_FIRST_RULE).toMatch(/\[[A-Za-z ]+\]/);
    expect(DRAFT_FIRST_RULE).toMatch(/at most (three|3)/i);
  });

  it("a question is the exception: only when no useful draft is possible, and then exactly one", () => {
    expect(DRAFT_FIRST_RULE).toMatch(/only when/i);
    expect(DRAFT_FIRST_RULE).toMatch(/exactly one question/i);
  });

  it("it never licenses inventing the missing details (it sits beside the no-invented-achievements rule, and says so itself)", () => {
    expect(DRAFT_FIRST_RULE).toMatch(/never invent/i);
    expect(NO_INVENTED_ACHIEVEMENTS_RULE).toMatch(/placeholder/i);
  });

  it("it is about writing something for the person; a coaching quick action keeps its own 'ask first' instructions", () => {
    expect(DRAFT_FIRST_RULE).toMatch(/write|draft/i);
    expect(DRAFT_FIRST_RULE).toMatch(/quick action/i);
    // the coaching chips still tell the model to ask first; this change must not remove that
    expect(quickActionInstructions("interview-prep")).toMatch(/ask in one short question/i);
    expect(quickActionInstructions("salary-negotiation")).toMatch(/ask in one short question/i);
  });

  it("every entry point's prompt carries the rule, once", () => {
    for (const key of ENTRY_POINTS) {
      const prompt = buildFarahChatSystemPrompt({ quickAction: key });
      expect(prompt, `${key ?? "free text"} prompt lacks the draft-first rule`).toContain(DRAFT_FIRST_RULE);
      expect(prompt.split(DRAFT_FIRST_RULE).length - 1, `${key ?? "free text"} carries it more than once`).toBe(1);
    }
  });
});

describe("an explicit length request is exempt from the 200-word rule", () => {
  it("the size rule still asks for short replies by default", () => {
    expect(REPLY_SIZE_RULE).toMatch(/under about 200 words/);
  });

  it("and says that a specific length asked for (the example is 500 words) is written to that length", () => {
    expect(REPLY_SIZE_RULE).toMatch(/specific length/i);
    expect(REPLY_SIZE_RULE).toMatch(/500 words/);
  });

  it("and says what to do when the length asked for will not fit in one reply (write the first part, say what comes next)", () => {
    expect(REPLY_SIZE_RULE).toMatch(/will not fit|won't fit/i);
    expect(REPLY_SIZE_RULE).toMatch(/first part/i);
  });
});

describe("the prompt stays small", () => {
  it("the two rules together stay under 700 characters (the new text is about 119 tokens, about 17,850 nano-dollars, 2.7% of a typical message)", () => {
    // The draft-first rule and the size rule's exemption are bounded so the per-minute token budget and the daily ceiling are not eaten by prose.
    expect((DRAFT_FIRST_RULE ?? "").length + REPLY_SIZE_RULE.length).toBeLessThan(700);
  });
});
