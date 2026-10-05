/**
 * askFarahChatStream hands an abort signal to the provider call. The route passes `request.signal` into `askFarahChatStream`; this is the next hop: the options it builds for `provider.generateTextStream`
 * carry that same signal. (The hop after that, into the HTTP request, is tests/llm/groq-signal.test.ts.) `signal` is passed through a loose cast: a typed option would stop `tsc` before the tests run.
 */
import { describe, expect, it, vi } from "vitest";

const seen: Array<Record<string, unknown>> = [];
const failoverOptsSeen: unknown[] = [];
vi.mock("@/lib/llm", async () => {
  const actual = await vi.importActual<typeof import("@/lib/llm")>("@/lib/llm");
  const provider = {
    name: "fake",
    model: "fake-model",
    async *generateTextStream(options: Record<string, unknown>) {
      seen.push(options);
      yield "ok";
    },
  };
  return {
    ...actual,
    generateChatStreamWithFailover: async function* (call: (p: unknown) => AsyncGenerator<string>, _onServed?: unknown, failoverOpts?: unknown) {
      failoverOptsSeen.push(failoverOpts);
      yield* call(provider);
    },
  };
});

describe("askFarahChatStream and the abort signal", () => {
  it("passes the caller's signal to the provider's generateTextStream options", async () => {
    const { askFarahChatStream } = await import("@/lib/farah/client");
    const controller = new AbortController();
    const opts = { signal: controller.signal } as never;
    for await (const _chunk of askFarahChatStream([{ role: "user", content: "hello" }], undefined, undefined, opts)) void _chunk;
    expect(seen).toHaveLength(1);
    expect(seen[0].signal, "the provider call did not receive the caller's signal").toBe(controller.signal);
  });

  it("passes nothing when the caller gave no signal (unchanged behaviour)", async () => {
    seen.length = 0;
    const { askFarahChatStream } = await import("@/lib/farah/client");
    for await (const _chunk of askFarahChatStream([{ role: "user", content: "hello" }])) void _chunk;
    expect(seen[0].signal).toBeUndefined();
  });

  it("passes the caller's allowFallback to the failover wrapper", async () => {
    failoverOptsSeen.length = 0;
    const { askFarahChatStream } = await import("@/lib/farah/client");
    const allowFallback = async () => true;
    for await (const _chunk of askFarahChatStream([{ role: "user", content: "hello" }], undefined, undefined, { allowFallback } as never)) void _chunk;
    expect((failoverOptsSeen[0] as { allowFallback?: unknown } | undefined)?.allowFallback, "the failover wrapper did not receive the caller's allowFallback").toBe(allowFallback);
  });
});
