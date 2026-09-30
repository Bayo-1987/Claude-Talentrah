/**
 * send-485 (b) — one success log line per Farah call, so "is the model really answering, and which one?"
 * can be read from the runtime logs instead of inferred (the question that took a day to answer in production).
 *
 * The line is a single JSON object with EXACTLY these keys:
 *   event       "farah_call" — a fixed marker to filter on
 *   provider    "groq" | "gemini" — the provider that actually SERVED the reply
 *   model       the concrete model id
 *   latency_ms  whole milliseconds from the call starting to the reply completing
 *   failover    true when the primary was rate-limited and the fallback served it
 *   request_id  a fresh random id per call
 *
 * and NEVER anything a user wrote or is: no message text, no reply text, no system prompt, no user id, no
 * email. The test below drives the REAL askFarah / askFarahChatStream through the REAL failover wrappers
 * with fake providers, feeds them a distinctive message, and asserts that string appears in NO console
 * output at all — not just in the farah_call line — so a future "helpful" extra log cannot leak it either.
 *
 * Charging logic is not involved and is not touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "SECRET-USER-MESSAGE-7f3a91";
const SECRET_REPLY = "SECRET-MODEL-REPLY-55c2e0";
const EMAIL = "someone.private@example.test";
const USER_ID = "11111111-2222-3333-4444-555555555555";

// Read once, at @/lib/llm's module load (pickProvider) — so it must be set before anything imports it.
vi.hoisted(() => {
  process.env.LLM_PROVIDER = "groq";
});

type Behaviour = { throwKind?: "rate_limit" | "auth"; reply?: string };
const behaviour: { groq: Behaviour; gemini: Behaviour } = { groq: {}, gemini: {} };

vi.mock("@/lib/llm/groq-provider", async () => {
  const { LLMProviderError } = await import("@/lib/llm/errors");
  return {
    GROQ_MODEL: "openai/gpt-oss-120b",
    GroqProvider: class {
      readonly name = "groq" as const;
      readonly model = "openai/gpt-oss-120b";
      async generateText() {
        if (behaviour.groq.throwKind) throw new LLMProviderError("groq", behaviour.groq.throwKind, "boom");
        return behaviour.groq.reply ?? SECRET_REPLY;
      }
      async generateWithUsage() {
        return { text: await this.generateText(), usage: null };
      }
      async *generateTextStream() {
        if (behaviour.groq.throwKind) throw new LLMProviderError("groq", behaviour.groq.throwKind, "boom");
        yield behaviour.groq.reply ?? SECRET_REPLY;
        yield " more";
      }
    },
  };
});
vi.mock("@/lib/llm/gemini-provider", async () => {
  const { LLMProviderError } = await import("@/lib/llm/errors");
  return {
    GEMINI_MODEL: "gemini-test-model",
    GeminiProvider: class {
      readonly name = "gemini" as const;
      readonly model = "gemini-test-model";
      async generateText() {
        if (behaviour.gemini.throwKind) throw new LLMProviderError("gemini", behaviour.gemini.throwKind, "boom");
        return behaviour.gemini.reply ?? SECRET_REPLY;
      }
      async generateWithUsage() {
        return { text: await this.generateText(), usage: null };
      }
      async *generateTextStream() {
        if (behaviour.gemini.throwKind) throw new LLMProviderError("gemini", behaviour.gemini.throwKind, "boom");
        yield behaviour.gemini.reply ?? SECRET_REPLY;
      }
    },
  };
});

const captured: string[] = [];
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  captured.length = 0;
  behaviour.groq = {};
  behaviour.gemini = {};
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    spies.push(
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        captured.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a, (_k, v) => (v instanceof Error ? `${v.name}: ${v.message}` : v)))).join(" "));
      }),
    );
  }
});
afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
});

async function client() {
  return await import("@/lib/farah/client");
}
async function drain(gen: AsyncGenerator<string>) {
  let text = "";
  for await (const c of gen) text += c;
  return text;
}
/** Every captured console line that is a farah_call object. */
function farahCallLines(): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const line of captured) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && parsed.event === "farah_call") out.push(parsed);
    } catch {
      /* not JSON */
    }
  }
  return out;
}
const TURNS = [{ role: "user" as const, content: SECRET }];

describe("the farah_call line", () => {
  it("is emitted exactly once for a streamed chat reply, with exactly the agreed keys and sane values", async () => {
    const { askFarahChatStream } = await client();
    await drain(askFarahChatStream(TURNS, `Resume context for ${EMAIL} (${USER_ID})`));
    const lines = farahCallLines();
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(Object.keys(line).sort()).toEqual(["event", "failover", "latency_ms", "model", "provider", "request_id"]);
    expect(line.event).toBe("farah_call");
    expect(line.provider).toBe("groq");
    expect(line.model).toBe("openai/gpt-oss-120b");
    expect(line.failover).toBe(false);
    expect(Number.isInteger(line.latency_ms) && (line.latency_ms as number) >= 0).toBe(true);
    expect(line.request_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("is also emitted for the one-shot calls (askFarah, askFarahChat)", async () => {
    const { askFarah, askFarahChat } = await client();
    await askFarah(SECRET);
    await askFarahChat(TURNS);
    const lines = farahCallLines();
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(Object.keys(l).sort()).toEqual(["event", "failover", "latency_ms", "model", "provider", "request_id"]);
  });

  it("gives each call its own request id", async () => {
    const { askFarah } = await client();
    await askFarah("one");
    await askFarah("two");
    const [a, b] = farahCallLines();
    expect(a.request_id).not.toBe(b.request_id);
  });

  it("names the provider that SERVED the reply and sets failover when Groq was rate-limited first", async () => {
    behaviour.groq = { throwKind: "rate_limit" };
    const { askFarahChatStream, askFarah } = await client();
    await drain(askFarahChatStream(TURNS));
    await askFarah(SECRET);
    const lines = farahCallLines();
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l.provider).toBe("gemini");
      expect(l.model).toBe("gemini-test-model");
      expect(l.failover).toBe(true);
    }
  });

  it("writes NO success line for a call that failed (an auth error is not retried and not a success)", async () => {
    behaviour.groq = { throwKind: "auth" };
    const { askFarahChatStream, askFarah } = await client();
    await expect(drain(askFarahChatStream(TURNS))).rejects.toThrow();
    await expect(askFarah(SECRET)).rejects.toThrow();
    expect(farahCallLines()).toHaveLength(0);
  });

  it("writes NO success line when both providers fail", async () => {
    behaviour.groq = { throwKind: "rate_limit" };
    behaviour.gemini = { throwKind: "rate_limit" };
    const { askFarah } = await client();
    await expect(askFarah(SECRET)).rejects.toThrow();
    expect(farahCallLines()).toHaveLength(0);
  });
});

describe("what must never appear in the logs", () => {
  it("no console output of any kind contains the user's message, the reply, the system prompt, an email or a user id", async () => {
    const { askFarahChatStream, askFarah, askFarahChat } = await client();
    const { FARAH_SYSTEM_PROMPT } = await import("@/lib/farah/system-prompt");
    await drain(askFarahChatStream(TURNS, `Resume context for ${EMAIL} (${USER_ID})`));
    await askFarah(SECRET);
    await askFarahChat(TURNS);
    behaviour.groq = { throwKind: "rate_limit" };
    await drain(askFarahChatStream(TURNS));

    // Control: the calls really ran and really logged (otherwise "nothing leaked" is vacuous).
    expect(farahCallLines().length).toBe(4);
    const everything = captured.join("\n");
    expect(everything.length).toBeGreaterThan(0);

    for (const forbidden of [SECRET, SECRET_REPLY, EMAIL, USER_ID, FARAH_SYSTEM_PROMPT.slice(0, 40)]) {
      expect(everything, `a log line contained: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("the line's own serialisation is one line of JSON with no free-text field", async () => {
    const { askFarah } = await client();
    await askFarah(SECRET);
    const raw = captured.find((l) => l.includes('"farah_call"'))!;
    expect(raw).not.toContain("\n");
    const line = JSON.parse(raw);
    for (const v of Object.values(line)) {
      // Every value is a short scalar; nothing that could carry a paragraph.
      expect(["string", "number", "boolean"]).toContain(typeof v);
      if (typeof v === "string") expect(v.length).toBeLessThanOrEqual(64);
    }
  });
});
