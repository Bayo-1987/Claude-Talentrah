"use client";

import { useState, useTransition } from "react";
import { submitMentorshipReviewAction } from "@/lib/mentorship/actions";
import { Button } from "@/components/ui";

/** One review per completed session — 0133's own UNIQUE on session_id is the real guard; a second submit here just surfaces that as a plain error. */
export function ReviewForm({ sessionId, mentorId }: { sessionId: string; mentorId: string }) {
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) return <p className="text-[13px] text-ink-soft">Thanks for the review.</p>;

  return (
    <form
      className="flex flex-col gap-2 border-t border-line pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          try {
            await submitMentorshipReviewAction(sessionId, mentorId, rating, text);
            setDone(true);
          } catch {
            setError("Could not submit that review — you may have already reviewed this session.");
          }
        });
      }}
    >
      <label className="font-body text-[12.5px] font-semibold text-ink-soft">
        Rate this session
        <select
          value={rating}
          onChange={(e) => setRating(Number(e.target.value))}
          className="ml-2 min-h-9 border-[1.5px] border-ink bg-card px-2 font-body text-[13.5px]"
        >
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>{n} ★</option>
          ))}
        </select>
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Optional note for other seekers"
        className="min-h-16 border-[1.5px] border-ink bg-card p-2.5 font-body text-[13.5px]"
      />
      {error && <p className="text-[12.5px] text-rust">{error}</p>}
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        Submit review
      </Button>
    </form>
  );
}
