"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EyebrowLabel, FarahMark } from "@/components/ui";
import { FARAH_QUICK_ACTIONS } from "@/lib/farah/quick-actions";
import { renderFarahMarkdown } from "@/lib/farah/render-markdown";
import { readFarahChatStream } from "@/lib/farah/read-chat-stream";
import {
  JOB_SEED_CHAT_STARTERS,
  coverLetterHref,
  jobSeedOpener,
  onFarahJobSeed,
  tailorHref,
  type FarahJobSeed,
} from "@/lib/farah/job-seed";

export interface FarahMessage {
  id: string;
  role: "user" | "farah";
  content: string;
  created_at: string;
}

export interface FarahPanelProps {
  firstName: string;
  /**
   * Optional, and normally omitted.
   *
   * The panel loads its own history now (see the effect below), so the app
   * shell no longer passes anything here. The prop survives for tests and
   * for any caller that genuinely has the messages in hand already and would
   * rather not have the panel re-fetch them.
   */
  initialMessages?: FarahMessage[];
  /**
   * Escape hatch for tests, same convention as `initialMessages` above —
   * the real seed always arrives via `onFarahJobSeed` (see job-seed.ts's own
   * header for why a window event rather than a prop threaded from a job
   * card several trees away), which `renderToStaticMarkup` never runs
   * (effects don't execute under it), so a render-level test has no other
   * way to exercise the seeded view.
   */
  initialJobSeed?: FarahJobSeed;
}

/**
 * The four job-seed actions (two real chat starters, tailor, cover letter) —
 * shared between the pristine empty-state reveal and a mid-conversation
 * job-seed marker, so a later "Ask Farah" click offers exactly what the
 * first one would have. `keyPrefix` keeps React keys unique when more than
 * one marker is on screen at once (one per job switched to this session).
 */
function JobSeedActions({
  seed,
  pending,
  onStarter,
  keyPrefix,
}: {
  seed: FarahJobSeed;
  pending: boolean;
  onStarter: (label: string, quickAction: string, jobId: string) => void;
  keyPrefix: string;
}) {
  return (
    <div className="flex flex-col">
      {JOB_SEED_CHAT_STARTERS.map((starter) => (
        <button
          key={`${keyPrefix}-${starter.label}`}
          type="button"
          disabled={pending}
          onClick={() => onStarter(starter.label, starter.key, seed.jobId)}
          className="flex min-h-10 items-center py-1 text-left font-body text-[13.5px] font-semibold text-ink underline underline-offset-2 hover:text-coral disabled:cursor-not-allowed disabled:opacity-50"
        >
          {starter.label}
        </button>
      ))}
      <Link
        href={tailorHref(seed.jobId)}
        className="flex min-h-10 items-center py-1 font-body text-[13.5px] font-semibold text-ink underline underline-offset-2 hover:text-coral"
      >
        Tailor my resume for this job →
      </Link>
      <Link
        href={coverLetterHref(seed.jobId)}
        className="flex min-h-10 items-center py-1 font-body text-[13.5px] font-semibold text-ink underline underline-offset-2 hover:text-coral"
      >
        Draft an intro message for this job →
      </Link>
    </div>
  );
}

/**
 * The divider a later "Ask Farah" click inserts into an already-open
 * conversation — see `jobSeedMarkers` on `FarahPanel` for why this exists.
 * The eyebrow label is the disambiguation itself: whatever's above it is a
 * previous job, whatever's below (including these actions) is this one.
 */
function JobSeedMarker({
  seed,
  pending,
  onStarter,
  markerId,
}: {
  seed: FarahJobSeed;
  pending: boolean;
  onStarter: (label: string, quickAction: string, jobId: string) => void;
  markerId: string;
}) {
  return (
    <div data-testid="job-seed-divider" className="flex flex-col gap-3 border-t border-dashed border-line pt-4">
      <EyebrowLabel size="sm">
        Now looking at: {seed.jobTitle} at {seed.companyName}
      </EyebrowLabel>
      <p className="font-display text-[14.5px] italic leading-relaxed text-ink-soft">
        {jobSeedOpener(seed)}
      </p>
      <JobSeedActions seed={seed} pending={pending} onStarter={onStarter} keyPrefix={markerId} />
    </div>
  );
}

/**
 * Marginalia panel — carried over structurally unchanged from Editorial's
 * "never a boxed chat widget, no card background, no radius, no shadow"
 * rule.
 *
 * KNOWN DIVERGENCE FROM THE SUNBIRD ARTBOARDS, FLAGGED RATHER THAN SILENTLY
 * FIXED: both SunbirdFeed.dc.html and SunbirdDetail.dc.html actually draw
 * this panel as a full elevated card (rounded-2xl, `background:var(--card)`,
 * the same soft shadow every other card gets) — not flat marginalia. Adopting
 * that fully means restructuring this component's sticky/scroll shell (and
 * the wrapper in (app)/layout.tsx that currently owns the column's
 * background and hairline) and re-verifying every Farah e2e spec that
 * depends on its current geometry. That is a real, deliberate scope decision
 * for the PR that swaps this component, not something to guess at inside a
 * broader token/primitive sweep — left as Editorial's flat treatment for now.
 *
 * THE COLUMN'S OWN CHROME IS NOT ALL HERE, which is worth knowing before
 * reading the classes below and concluding something is missing. The colour
 * field (`bg-bg-alt`) and the left hairline live on the wrapper in
 * (app)/layout.tsx, because both run the length of the COLUMN and this
 * component is only ever as tall as its content. What stays here is what marks
 * where Farah's content begins: the 3px coral top rule and the mark beside the
 * eyebrow. Farah's turns are set in
 * italic display serif (matching the greeting copy this replaced); the user's
 * are plain body text — that typographic split is the only visual
 * differentiation, on purpose, rather than chat-bubble styling.
 */
export function FarahPanel({ firstName, initialMessages, initialJobSeed }: FarahPanelProps) {
  const [messages, setMessages] = useState<FarahMessage[]>(initialMessages ?? []);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  /**
   * True from the moment a request is sent until the first streamed chunk
   * of Farah's reply arrives (or the call fails before ever streaming one).
   * Distinct from `pending`, which spans the whole request: "Farah is
   * thinking…" below should disappear the instant real text starts
   * appearing, not stay up next to a reply that's already rendering.
   */
  const [awaitingFirstToken, setAwaitingFirstToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * send-100 — set by a job card's "Ask Farah" button (job-seed.ts), read
   * only while `messages` is still empty (see the render below). Once a
   * real conversation has started this is no longer what's shown — see
   * `jobSeedMarkers` just below for that case.
   */
  const [jobSeed, setJobSeed] = useState<FarahJobSeed | null>(initialJobSeed ?? null);

  /*
   * A LATER "Ask Farah" click, once a conversation already has content.
   *
   * THE BUG THIS EXISTS TO FIX. `jobSeed` above is only read by the
   * empty-state branch below, so send-100's original comment described the
   * post-first-click behaviour as "a later click elsewhere still updates
   * this but has nothing left to show it in" — true, but the actual result
   * was worse than a no-op: the panel kept displaying whatever answer was
   * already on screen, about the PREVIOUS job, with nothing marking it as
   * stale. A reader who clicked "Ask Farah" on job B after already asking
   * about job A saw job A's real answer sitting there looking like it was
   * about job B. The original worry (don't yank an in-progress conversation
   * out from under the reader) was reasonable; the fix is to ADD a way to
   * ask about the new job rather than silently doing nothing.
   *
   * Each entry is inserted into the rendered timeline at `insertAt` (a
   * snapshot of `messages.length` at the moment the seed arrived), so a
   * divider + fresh starters for the new job appear in the right place
   * chronologically even if the reader keeps chatting and later switches to
   * a third job. Never sent to the server and never persisted — same
   * "purely client-side" status as `jobSeed` itself (see job-seed.ts).
   */
  const [jobSeedMarkers, setJobSeedMarkers] = useState<
    Array<{ id: string; seed: FarahJobSeed; insertAt: number }>
  >([]);
  const messagesRef = useRef<FarahMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(
    () =>
      onFarahJobSeed((seed) => {
        setJobSeed(seed);
        const currentLength = messagesRef.current.length;
        // A pristine panel: the empty-state branch below already shows this
        // seed directly, no divider needed — that view *is* the reveal.
        if (currentLength === 0) return;
        setJobSeedMarkers((prev) => {
          // The same job clicked again mid-conversation — nothing changed,
          // don't stack a redundant divider.
          if (prev.length > 0 && prev[prev.length - 1].seed.jobId === seed.jobId) return prev;
          return [...prev, { id: crypto.randomUUID(), seed, insertAt: currentLength }];
        });
      }),
    [],
  );
  /*
   * The gate's own indicator (0123) — `null` until the history fetch below
   * resolves, and stays `null` for a Pass holder (the route itself omits it
   * then; see /api/farah/history's own comment for why). Not shown at all
   * while unknown, rather than a placeholder number that might be wrong.
   */
  const [freeRemaining, setFreeRemaining] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const localIdCounter = useRef(0);
  /*
   * One id per mount, sent with every chat request so the server can tell a
   * session's first message from its second-plus (src/lib/farah/
   * session-events.ts) — purely a counter concern, generated lazily so it
   * costs nothing on a render that never sends a message. Not persisted or
   * reused across a reload: an undercounted session (this mount ends, a new
   * one starts) is the safer direction to be wrong in for a metric deciding
   * whether real threads are worth building, versus a stale id silently
   * merging two unrelated visits into one session.
   */
  const sessionIdRef = useRef<string | null>(null);
  function sessionId(): string {
    if (!sessionIdRef.current) sessionIdRef.current = crypto.randomUUID();
    return sessionIdRef.current;
  }

  /*
   * ── FETCHED, BUT NOT SHOWN UNTIL ASKED FOR ────────────────────────────
   *
   * The panel used to prepend fetched history straight into `messages`,
   * which meant arriving on ANY page with the panel dropped the reader into
   * the tail of whatever they last said to Farah — a fragment of an
   * unrelated interview-prep answer, cut off at the top of a 320px scroller,
   * pushing the quick actions below the fold. History itself was never the
   * bug; showing it as the FIRST thing on arrival was.
   *
   * `historyRevealed` starts true when a caller passed `initialMessages`
   * explicitly (see that prop's own doc comment) — an explicit override is
   * the caller asking for exactly these messages up front, not the
   * self-fetch path this component's own arrival behaviour is about.
   */
  const [pendingHistory, setPendingHistory] = useState<FarahMessage[] | null>(null);
  const [historyRevealed, setHistoryRevealed] = useState(!!initialMessages);

  /*
   * ── HISTORY IS LOADED HERE, NOT BY THE SERVER ─────────────────────────
   *
   * (app)/layout.tsx used to read `farah_messages` and hand the result down
   * as `initialMessages`. That layout wraps every signed-in page, so the
   * query — and the extra Supabase client built to run it — sat on the
   * critical path of the feed, the tracker and billing alike, delaying the
   * document for a conversation most readers never open. Production has 43
   * messages across 40 accounts: overwhelmingly it fetched nothing, slowly.
   *
   * Fetching it here instead means the page paints first and the history
   * arrives after, which is the correct priority for a side panel.
   *
   * `ignore` guards the unmount race — React 18 StrictMode mounts effects
   * twice in development, and without it the second response can land after
   * the component is gone or clobber messages sent in between.
   *
   * Skipped entirely when a caller supplied messages, so passing them stays
   * a real override rather than a hint the panel then ignores.
   */
  useEffect(() => {
    if (initialMessages) return;
    let ignore = false;
    void (async () => {
      try {
        const res = await fetch("/api/farah/history");
        if (!res.ok) return;
        const data = await res.json();
        if (ignore) return;
        if (typeof data.freeMessagesRemaining === "number" || data.freeMessagesRemaining === null) {
          setFreeRemaining(data.freeMessagesRemaining);
        }
        if (!Array.isArray(data.messages) || data.messages.length === 0) return;
        // Held, not shown — see historyRevealed above. Nothing here decides
        // whether the reader sees it; "Continue" below does.
        setPendingHistory(data.messages as FarahMessage[]);
      } catch {
        // Silent: history is an enhancement. The panel is fully usable
        // without it, and an error banner over a side column for something
        // the reader never asked for would be noise.
      }
    })();
    return () => {
      ignore = true;
    };
  }, [initialMessages]);

  /*
   * The ONLY way pendingHistory ever reaches `messages`. History is never
   * deleted and this component never asks the server to forget anything —
   * every Farah call spends credits or pass allowance, so a panel that
   * forgot context would make a user pay twice to re-establish it. What
   * changes here is display only: revealing turns the held-back rows into
   * exactly what the old "prepend on load" behaviour would have shown,
   * just on request instead of by default.
   */
  function continueConversation() {
    if (!pendingHistory) return;
    setMessages((prev) => [...pendingHistory, ...prev]);
    setHistoryRevealed(true);
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending, awaitingFirstToken]);

  async function send(text: string, quickAction?: string, jobId?: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setError(null);
    setPending(true);
    setAwaitingFirstToken(true);
    setInput("");

    const optimisticId = `optimistic-${localIdCounter.current++}`;
    setMessages((prev) => [
      ...prev,
      { id: optimisticId, role: "user", content: trimmed, created_at: new Date().toISOString() },
    ]);

    // Placeholder id for the streaming reply, swapped for the real
    // database id once the "done" event arrives (or kept as-is if
    // persistence failed — see chat/route.ts's own comment on that case).
    const streamId = `stream-${localIdCounter.current++}`;

    try {
      const res = await fetch("/api/farah/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, quickAction, sessionId: sessionId(), jobId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        setError(data.error ?? "Something went wrong — try again.");
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        return;
      }

      for await (const event of readFarahChatStream(res)) {
        if (event.type === "delta") {
          setAwaitingFirstToken(false);
          // Upsert rather than an "already started?" flag: whether the
          // streaming message exists yet is read from `prev` itself, not
          // from a variable this closure would otherwise need to mutate.
          setMessages((prev) =>
            prev.some((m) => m.id === streamId)
              ? prev.map((m) => (m.id === streamId ? { ...m, content: event.fullText } : m))
              : [...prev, { id: streamId, role: "farah", content: event.fullText, created_at: new Date().toISOString() }],
          );
        } else if (event.type === "error") {
          setError(event.message ?? "Something went wrong — try again.");
          setMessages((prev) => prev.filter((m) => m.id !== optimisticId && m.id !== streamId));
          return;
        } else if (event.type === "done") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamId ? { ...m, id: event.id ?? streamId, created_at: event.createdAt ?? m.created_at } : m,
            ),
          );
          if (typeof event.freeMessagesRemaining === "number" || event.freeMessagesRemaining === null) {
            setFreeRemaining(event.freeMessagesRemaining ?? null);
          }
        }
      }
    } catch {
      setError("Couldn't reach Farah — check your connection and try again.");
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId && m.id !== streamId));
    } finally {
      setPending(false);
      setAwaitingFirstToken(false);
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

      THAT SAME FACT IS NOW LOAD-BEARING FOR THE COLUMN'S CHROME, not just for
      the stickiness. Because this element is short and the wrapper is the full
      column, anything meant to run the column's whole height has to be painted
      on the wrapper: the tint sat here first and stopped 511px down while the
      feed carried on for 36,561px, and the hairline had the same problem after
      it. Both moved. Do not move them back on the assumption that "the panel"
      means the column — here it does not.

      `max-h` and `overflow-y-auto` stay. They do nothing for the stickiness —
      the panel is 609px, well under the viewport — but they are what keeps a
      long Farah conversation scrolling inside the panel rather than pushing
      the page.

      68px is the masthead's height; the panel starts below it.

      ALL OF THAT IS THE >=760px CASE. Stacked under the content column on a
      phone, none of it applies and each part would be actively wrong: sticky
      would pin the panel over the cards it sits beneath, and max-h would trap a
      conversation in a short scroller inside a page that already scrolls. So
      they are min-[760px]: and the mobile case is the plain one — a full-width
      section with the coral rule along the top separating it from the feed.

      The left hairline used to be in that list. It is on the wrapper now, and
      still min-[760px]: there for the same reason: a rule down the side of a
      full-width block would be drawing an edge that is not there.

      PADDING IS SYMMETRIC AT DESKTOP — min-[760px]:px-7, one utility, not
      px-0 plus pl-7. It was the one-sided pair, which gave the column 28px on
      the left and nothing on the right, so the eyebrow row, the greeting and
      the quick-action links all ran flush to where the panel's box ends.

      The reason it was ever one-sided no longer applies. When this element
      carried the column's own chrome, a right inset would have been padding
      against nothing. The field and its hairline are on the wrapper now, so
      what sits to the right of this text is the column continuing — and text
      set hard against that is text with no margin, not text meeting an edge.

      If a future change reaches for pl-7 again, this is the note saying the
      asymmetry was the bug.
    */
    <div
      data-testid="farah-panel"
      className="flex w-full flex-col gap-5.5 border-t-[3px] border-t-coral px-6 py-8 min-[760px]:sticky min-[760px]:top-[68px] min-[760px]:max-h-[calc(100vh-68px)] min-[760px]:w-[280px] min-[760px]:flex-shrink-0 min-[760px]:overflow-y-auto min-[760px]:px-7"
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

      {/*
        The gate's own indicator (0123) — plain body text, no
        pill/badge, no gamification meter, per the design system's own
        hard rule. `null` (unknown, or an active Pass) renders nothing:
        silence is correct there, it's only a hard 0 with no warning that
        reads as broken.
      */}
      {freeRemaining !== null && (
        <p className="text-[12px] text-ink-soft">
          {freeRemaining > 0
            ? `${freeRemaining} free message${freeRemaining === 1 ? "" : "s"} left in the last 30 days.`
            : "You've used your free messages in the last 30 days — further messages use credits."}
        </p>
      )}

      <div ref={scrollRef} className="flex max-h-80 flex-col gap-3 overflow-y-auto">
        {messages.length === 0 ? (
          jobSeed ? (
            /*
              send-100's seeded opener — free, instant, client-rendered only.
              This branch never calls the LLM, never hits /api/farah/chat,
              never writes a farah_messages row: `jobSeedOpener` is a plain
              template function and the four items below are the first thing
              that costs anything, exactly like this panel's own default
              greeting it replaces here (same reasoning, same free status).
            */
            <>
              <p className="font-display text-[14.5px] italic leading-relaxed text-ink-soft">
                {jobSeedOpener(jobSeed)}
              </p>
              {/*
                Real generation, unchanged — same /tailor flow and same
                credit gate the job card's old Land group already pointed
                at, not a new path. See job-seed.ts's own header on why the
                fourth Orion-style slot is this rather than a fabricated
                "Connections" feature Talentrah doesn't have.
              */}
              <JobSeedActions
                seed={jobSeed}
                pending={pending}
                onStarter={(label, quickAction, jobId) => void send(label, quickAction, jobId)}
                keyPrefix="empty-state"
              />
            </>
          ) : (
            <>
              <p className="font-display text-[14.5px] italic leading-relaxed text-ink-soft">
                &ldquo;Hi {firstName} — I can tailor your resume to any of these
                roles, or help you prep. What do you need?&rdquo;
              </p>
              {/*
                The quiet line the earlier-conversation fix is actually about.
                Only offered here, on the pristine arrival view — once the
                reader has sent anything new this visit, `messages` stops being
                empty and this stops rendering with it. The history itself is
                still sitting in the database and still reaches every future
                call to Farah either way (see chat/route.ts, unaffected by any
                of this); this only decides what's on screen before anyone
                chooses.
              */}
              {pendingHistory && pendingHistory.length > 0 && !historyRevealed && (
                <button
                  type="button"
                  onClick={continueConversation}
                  className="text-left font-display text-[13px] italic text-ink-soft underline underline-offset-2 hover:text-coral"
                >
                  Continue where you left off with Farah?
                </button>
              )}
            </>
          )
        ) : (
          <>
            {messages.map((m, i) => (
              <Fragment key={m.id}>
                {jobSeedMarkers
                  .filter((marker) => marker.insertAt === i)
                  .map((marker) => (
                    <JobSeedMarker
                      key={marker.id}
                      markerId={marker.id}
                      seed={marker.seed}
                      pending={pending}
                      onStarter={(label, quickAction, jobId) => void send(label, quickAction, jobId)}
                    />
                  ))}
                {m.role === "farah" ? (
                  <div data-testid="farah-message">{renderFarahMarkdown(m.content)}</div>
                ) : (
                  <p data-testid="farah-message" className="text-right font-body text-[13px] text-ink">
                    {m.content}
                  </p>
                )}
              </Fragment>
            ))}
            {/* A job seeded after the last message so far — same "insertAt
                the current length" bookkeeping, walked past the end of the
                array above since there's no message index left to attach
                to. */}
            {jobSeedMarkers
              .filter((marker) => marker.insertAt === messages.length)
              .map((marker) => (
                <JobSeedMarker
                  key={marker.id}
                  markerId={marker.id}
                  seed={marker.seed}
                  pending={pending}
                  onStarter={(label, quickAction, jobId) => void send(label, quickAction, jobId)}
                />
              ))}
          </>
        )}
        {awaitingFirstToken && <p className="font-display text-[13px] italic text-ink-soft">Farah is thinking…</p>}
      </div>

      {error && (
        <p className="border border-coral bg-coral-soft px-2.5 py-2 text-[12px] text-coral">{error}</p>
      )}

      <div className="flex flex-col border-t border-dashed border-line pt-4">
        {FARAH_QUICK_ACTIONS.map((action) =>
          action.href ? (
            <Link
              key={action.key}
              href={action.href}
              className="flex min-h-10 items-center py-1 font-body text-[13.5px] font-semibold text-ink underline underline-offset-2 hover:text-coral"
            >
              {action.label}
            </Link>
          ) : (
            <button
              key={action.key}
              type="button"
              disabled={pending}
              onClick={() => void send(action.starterPrompt as string, action.key)}
              className="flex min-h-10 items-center py-1 text-left font-body text-[13.5px] font-semibold text-ink underline underline-offset-2 hover:text-coral disabled:cursor-not-allowed disabled:opacity-50"
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
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center bg-ink text-bg disabled:opacity-50"
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
