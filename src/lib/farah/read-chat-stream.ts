export type FarahChatStreamEvent =
  | { type: "delta"; fullText: string }
  | { type: "error"; message?: string }
  | { type: "done"; id?: string | null; createdAt?: string; freeMessagesRemaining?: number | null };

/**
 * Parses the NDJSON stream `POST /api/farah/chat` returns once the request
 * itself succeeds — one `{...}\n` event per line (see that route's own
 * comment for why NDJSON rather than SSE). A "delta" event here carries the
 * FULL accumulated reply so far, not just the newly-arrived fragment, so a
 * caller can set state directly from `event.fullText` without keeping its
 * own running total — deliberately, so the component using this has no
 * mutable accumulator of its own to trip the React Compiler's immutability
 * check (mutating a variable inside a component/hook body, even inside a
 * nested async closure, reads as a render-purity violation to it).
 *
 * `buffer` exists because a network chunk boundary has no relationship to a
 * line boundary in the stream — the last, possibly-incomplete line of each
 * read is held over rather than parsed.
 */
export async function* readFarahChatStream(response: Response): AsyncGenerator<FarahChatStreamEvent> {
  if (!response.body) throw new Error("No response body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "delta") {
        fullText += event.text;
        yield { type: "delta", fullText };
      } else if (event.type === "error") {
        yield { type: "error", message: event.message };
        return;
      } else if (event.type === "done") {
        yield {
          type: "done",
          id: event.id,
          createdAt: event.createdAt,
          freeMessagesRemaining: event.freeMessagesRemaining,
        };
      }
    }
  }
}
