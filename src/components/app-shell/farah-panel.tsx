"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EyebrowLabel, FarahMark } from "@/components/ui";
import { FARAH_QUICK_ACTIONS } from "@/lib/farah/quick-actions";

export interface FarahMessage {
  id: string;
  role: "user" | "farah";
  content: string;
  created_at: string;
}

export interface FarahPanelProps {
  firstName: string;
  initialMessages: FarahMessage[];
}

/**
 * Marginalia panel per design handoff §7 — 280px column, border-left only,
 * no card background, never a boxed chat widget. Farah's turns are set in
 * italic Newsreader (matching the greeting copy this replaced); the user's
 * are plain body text — that typographic split is the only visual
 * differentiation, on purpose, rather than chat-bubble styling.
 */
export function FarahPanel({ firstName, initialMessages }: FarahPanelProps) {
  const [messages, setMessages] = useState<FarahMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const localIdCounter = useRef(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  async function send(text: string, quickAction?: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setError(null);
    setPending(true);
    setInput("");

    const optimisticId = `optimistic-${localIdCounter.current++}`;
    setMessages((prev) => [
      ...prev,
      { id: optimisticId, role: "user", content: trimmed, created_at: new Date().toISOString() },
    ]);

    try {
      const res = await fetch("/api/farah/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, quickAction }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong — try again.");
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: data.id ?? `local-${localIdCounter.current++}`,
          role: "farah",
          content: data.reply,
          created_at: data.createdAt,
        },
      ]);
    } catch {
      setError("Couldn't reach Farah — check your connection and try again.");
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void send(input);
  }

  return (
    /*
      WHY THERE IS NO `self-start` HERE, having tried it.
      
      The intuition — flex `align-items: stretch` makes this full height, so a
      sticky element has nowhere to travel — is right in general and wrong in
      this layout. This component is not the flex item: (app)/layout.tsx wraps
      it in a `print:hidden` div, and THAT is the item that stretches. Measured
      in a browser: the panel is 609px in a 35,648px row with or without
      `self-start`, and with or without the max-height. Both were inert.

      Same wrapper shape as the masthead, opposite outcome — and the two are
      worth telling apart, because the fixes are NOT the same.

        masthead   its wrapper is exactly its own height, so a sticky child has
                   no room to travel. The `sticky` had to MOVE to the wrapper.
        this panel its wrapper is the full page, so there is room to spare. The
                   `sticky` stays right here on the component and works.

      What the wrapper decides is whether a sticky child has anywhere to go —
      not where the `sticky` class belongs. Before adding one to anything else
      under this layout, measure the wrapper's height; do not assume either
      answer from the other case.

      `max-h` and `overflow-y-auto` stay. They do nothing for the stickiness —
      the panel is 609px, well under the viewport — but they are what keeps a
      long Farah conversation scrolling inside the panel rather than pushing
      the page.

      68px is the masthead's height; the panel starts below it.

      ALL OF THAT IS THE >=760px CASE. Stacked under the content column on a
      phone, none of it applies and each part would be actively wrong: sticky
      would pin the panel over the cards it sits beneath, max-h would trap a
      conversation in a short scroller inside a page that already scrolls, and
      border-l would draw a rule down the side of a full-width block. So they
      are all min-[760px]: and the mobile case is the plain one — a full-width
      section with a rule along the top separating it from the feed.
    */
    <div
      data-testid="farah-panel"
      className="flex w-full flex-col gap-5.5 border-t-[3px] border-t-rust bg-paper-alt px-6 py-8 min-[760px]:sticky min-[760px]:top-[68px] min-[760px]:max-h-[calc(100vh-68px)] min-[760px]:w-[280px] min-[760px]:flex-shrink-0 min-[760px]:overflow-y-auto min-[760px]:border-l min-[760px]:border-l-line min-[760px]:px-0 min-[760px]:pl-7"
    >
      {/*
        The name + "View profile" block that used to sit here is gone — both
        now live in the masthead's account menu, and repeating the name in the
        margin next to a greeting that already says it was the same fact twice
        on one screen.

        THE BORDER WENT WITH IT, deliberately. `border-t border-line pt-4.5`
        was the rule separating that block from this one. With nothing above,
        it would be a hairline across the top of the panel dividing the eyebrow
        from the panel's own edge — a line that looks like structure and marks
        nothing. The panel's `py-8` already sets the top inset.
      */}
      <div className="flex items-center gap-2.5">
        <FarahMark size={28} />
        <EyebrowLabel size="sm">Farah — your co-pilot</EyebrowLabel>
      </div>

      <div ref={scrollRef} className="flex max-h-80 flex-col gap-3 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="font-display text-[14.5px] italic leading-relaxed text-ink-soft">
            &ldquo;Hi {firstName} — I can tailor your resume to any of these
            roles, or help you prep. What do you need?&rdquo;
          </p>
        ) : (
          messages.map((m) =>
            m.role === "farah" ? (
              <p key={m.id} className="font-display text-[13.5px] italic leading-relaxed text-ink-soft">
                {m.content}
              </p>
            ) : (
              <p key={m.id} className="text-right font-body text-[13px] text-ink">
                {m.content}
              </p>
            ),
          )
        )}
        {pending && <p className="font-display text-[13px] italic text-ink-soft">Farah is thinking…</p>}
      </div>

      {error && (
        <p className="border border-rust bg-rust-soft px-2.5 py-2 text-[12px] text-rust">{error}</p>
      )}

      <div className="flex flex-col border-t border-dashed border-line pt-4">
        {FARAH_QUICK_ACTIONS.map((action) =>
          action.href ? (
            <Link
              key={action.key}
              href={action.href}
              className="flex min-h-10 items-center py-1 font-body text-[13.5px] font-semibold text-ink underline underline-offset-2 hover:text-rust"
            >
              {action.label}
            </Link>
          ) : (
            <button
              key={action.key}
              type="button"
              disabled={pending}
              onClick={() => void send(action.starterPrompt as string, action.key)}
              className="flex min-h-10 items-center py-1 text-left font-body text-[13.5px] font-semibold text-ink underline underline-offset-2 hover:text-rust disabled:cursor-not-allowed disabled:opacity-50"
            >
              {action.label}
            </button>
          ),
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="mt-auto flex items-center gap-2 border border-line bg-card px-2.5 py-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask me anything…"
          disabled={pending}
          /* 177 x 18.8 before this — a text field people have to hit on a
             phone was under half the minimum height. The 11px send button
             beside it was already right; the input was not. */
          className="min-h-10 flex-1 border-none bg-transparent font-display text-[12.5px] italic text-ink outline-none placeholder:text-ink-soft disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          aria-label="Send to Farah"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center bg-ink text-paper disabled:opacity-50"
        >
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M3 10 L17 3 L11 17 L9 11 L3 10Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </form>
    </div>
  );
}
