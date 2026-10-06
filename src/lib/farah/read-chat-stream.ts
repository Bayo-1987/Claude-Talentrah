export type FarahChatStreamEvent =
  | { type: "delta"; fullText: string }
  | {
      type: "error";
      message?: string;
      /** Which failure the route reported (see NOTHING_CHARGED_ERROR_KINDS in failure-note.ts); absent from an older server. Any non-string value is dropped. */
      kind?: string;
    }
  | {
      type: "done";
      id?: string | null;
      createdAt?: string;
      freeMessagesRemaining?: number | null;
      /**
       * When the next free message comes back, as an ISO time; `null` means "show no date" (a Pass is active, a free message is left, nothing was used in the window, or the server could not tell); absent
       * from an older server, which also means "show no date". Never a number or anything else: the parser drops any other value.
       */
      nextFreeMessageAt?: string | null;
      /** The account's new credit balance after a PAID message; null when nothing was spent, absent from an older server. */
      creditsBalance?: number | null;
      /**
       * The reply stopped because it hit the output ceiling, so it is cut off. It was not charged and did not use
       * up a free message. Only ever `true` or absent.
       */
      truncated?: boolean;
    };

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
        yield { type: "error", message: event.message, ...(typeof event.kind === "string" ? { kind: event.kind } : {}) };
        return;
      } else if (event.type === "done") {
        yield {
          type: "done",
          id: event.id,
          createdAt: event.createdAt,
          freeMessagesRemaining: event.freeMessagesRemaining,
          ...(typeof event.nextFreeMessageAt === "string" || event.nextFreeMessageAt === null ? { nextFreeMessageAt: event.nextFreeMessageAt } : {}),
          creditsBalance: event.creditsBalance,
          ...(event.truncated === true ? { truncated: true } : {}),
        };
      }
    }
  }
}
