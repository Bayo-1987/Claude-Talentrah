"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EyebrowLabel } from "@/components/ui";
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
    <div className="flex w-[280px] flex-shrink-0 flex-col gap-5.5 border-l border-line py-8 pl-7">
      <div>
        <span className="font-body text-[13px] font-bold text-ink">{firstName}</span>
        <div>
          {/* 61.3 x 18 before this. inline-flex so the box grows rather than
              the text, which keeps the panel's rhythm intact. */}
          <a
            href="/settings"
            className="inline-flex min-h-10 min-w-10 items-center text-[12.5px] underline underline-offset-2"
          >
            View profile
          </a>
        </div>
      </div>

      <div className="border-t border-line pt-4.5">
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
