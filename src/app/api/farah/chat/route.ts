import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { saveFarahExchange } from "@/lib/farah/save-exchange";
import { askFarahChatStream, type FarahChatTurn } from "@/lib/farah/client";
import { logFarahSessionMessage, type FarahEntryPoint } from "@/lib/farah/session-events";
import { FallbackDeclinedError, LLMProviderError } from "@/lib/llm";
import type { LLMFinishReason, LLMUsage } from "@/lib/llm/types";
import { GENERIC_FARAH_UNAVAILABLE_MESSAGE, farahRateLimitMessage } from "@/lib/farah/rate-limit-message";
import type { StructuredResume } from "@/lib/resume/types";
import {
  HISTORY_TURNS,
  MAX_HISTORY_MESSAGE_CHARS,
  MAX_MESSAGE_LENGTH,
  buildJobContext,
  buildResumeContext,
} from "@/lib/farah/token-budget";
import {
  checkFarahChatAllowance,
  commitFarahChatAllowance,
  farahChatNextFreeMessageAt,
  InsufficientCreditsError,
} from "@/lib/farah/chat-gate";
import { chipEntryPoint } from "@/lib/farah/chip-registry";
import { labelAsData } from "@/lib/farah/data-block";
import {
  FAILED_ATTEMPT_ESTIMATE_NANO,
  FARAH_BUSY_MESSAGE,
  FARAH_RESTING_MESSAGE,
  NO_COUNTS_REPLY_ESTIMATE_NANO,
  checkFallbackHeadroom,
  checkSpendCeiling,
  counterFailureLine,
  estimateSpendNano,
  secondsUntilUtcMidnight,
} from "@/lib/farah/spend-ceiling";
import { addSpendNano, markHalfwayWarned, readSpendNano } from "@/lib/farah/spend-tally";
import type { MatchExplanation } from "@/lib/matching/score";

/** Which entry point to log for a quick action: the chip registry decides (an unknown or absent key is free text). */
function resolveEntryPoint(quickAction: string | undefined): FarahEntryPoint {
  return chipEntryPoint(quickAction);
}

/**
 * A scripted-abuse backstop, independent of payment status (0123) — layered
 * UNDER the real entitlement gate below, not replaced by it. A Pass holder
 * or someone with a full credit balance shouldn't be able to script 500
 * messages an hour either; this cap has nothing to do with whether an
 * individual message is free, Pass-covered, or paid. Reuses farah_messages
 * itself as the counter rather than adding new schema for it.
 */
const MAX_USER_MESSAGES_PER_HOUR = 30;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const quickAction = typeof body.quickAction === "string" ? body.quickAction : undefined;
  const context = quickAction ? { quickAction } : {};
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
  // send-100: only ever sent alongside a job-seeded starter, but not
  // enforced as a pairing here — this route just grounds whatever jobId it
  // gets, silently skipping if the lookup below comes up empty.
  const jobId = typeof body.jobId === "string" ? body.jobId : undefined;

  if (!message) {
    return NextResponse.json({ error: "Say something for Farah to respond to." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `Keep it under ${MAX_MESSAGE_LENGTH} characters.` },
      { status: 400 },
    );
  }

  /*
   * The daily spend ceiling (migration 0223): checked before anything that costs money or changes state. It answers with a plain JSON refusal, like the other early refusals.
   * A counter that cannot be read fails CLOSED with its own code (distinct from the ceiling's): "can't check" is not "zero spent". Each branch writes exactly one content-free log line.
   */
  try {
    const ceiling = await checkSpendCeiling({ read: readSpendNano, markWarned: markHalfwayWarned });
    if (ceiling.status === "blocked") {
      console.warn("[farah-spend:ceiling] the daily spend ceiling is reached");
      return NextResponse.json(
        { error: FARAH_RESTING_MESSAGE, code: "farah_daily_ceiling" },
        { status: 503, headers: { "Retry-After": String(secondsUntilUtcMidnight(new Date())) } },
      );
    }
  } catch (err) {
    console.error(counterFailureLine(err));
    return NextResponse.json(
      { error: "Farah can't check today's capacity just now. Try again shortly.", code: "farah_spend_unavailable" },
      { status: 503, headers: { "Retry-After": "30" } },
    );
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentCount, error: countError } = await supabase
    .from("farah_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("role", "user")
    .gte("created_at", oneHourAgo);

  if (countError) {
    return NextResponse.json({ error: "Couldn't reach Farah — try again in a moment." }, { status: 500 });
  }
  if ((recentCount ?? 0) >= MAX_USER_MESSAGES_PER_HOUR) {
    return NextResponse.json(
      { error: "That's a lot of messages this hour — give it a little while and try again." },
      { status: 429 },
    );
  }

  /*
   * The real entitlement gate (0123) — checked BEFORE the Groq call below,
   * same reasoning src/lib/tailoring/gate.ts's own check/commit split
   * gives: an unaffordable message must never trigger (and cost Talentrah
   * for) an LLM request. commitFarahChatAllowance runs only after that call
   * actually succeeds, so a failed reply never burns the free allowance,
   * the Pass's daily cap, or a credit spend for nothing. Applies identically
   * to every entry point — free-text chat and the quick actions that also
   * resolve here (interview-prep, career-advisor, salary-negotiation) share
   * the exact same counter, not a separate one per surface.
   */
  let allowance;
  try {
    allowance = await checkFarahChatAllowance(user.id);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return NextResponse.json(
        {
          error:
            err.capMessage ??
            `Not enough credits — this needs ${err.required}, you have ${err.available}.`,
          needsCredits: true,
        },
        { status: 402 },
      );
    }
    throw err;
  }

  // Best-effort, and independent of whether Farah's reply below succeeds —
  // this counts what the user actually did (sent a message from this entry
  // point), not whether a downstream LLM call happened to work. No
  // sessionId (an older client, or a caller that isn't the panel) just skips
  // logging rather than guessing one.
  if (sessionId) {
    await logFarahSessionMessage({ userId: user.id, sessionId, entryPoint: resolveEntryPoint(quickAction) });
  }

  // Independent reads — neither depends on the other's result — so they run
  // together instead of one after the other.
  const [{ data: historyRows, error: historyError }, { data: baseResumeRow }] = await Promise.all([
    supabase
      .from("farah_messages")
      .select("role, content")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(HISTORY_TURNS),
    supabase.from("resumes").select("structured_content").eq("user_id", user.id).eq("is_base", true).maybeSingle(),
  ]);

  if (historyError) {
    return NextResponse.json({ error: "Couldn't reach Farah — try again in a moment." }, { status: 500 });
  }

  const baseResume = baseResumeRow?.structured_content as StructuredResume | null;
  // Both caps matter, and for different reasons. Slicing the skills list stops
  // the common case (a skills-heavy resume) from dominating the request, while
  // the character ceiling is the backstop that makes the size independent of
  // how any single field was written — a 4,000-character summary would sail
  // past a skills-only cap. Truncating after building keeps the leading
  // "don't invent detail" instruction, which a head-truncation would preserve
  // and a tail-truncation would not.
  const resumeContext = baseResume ? labelAsData("resume", buildResumeContext(baseResume)) : undefined;

  /*
   * send-100's job grounding. Both queries go through `supabase` — the
   * SESSION-scoped, RLS-enforced client this route already uses, not a
   * service-role client — so an unverified org's posting or another user's
   * match_scores row can't leak in here just because a client sent that
   * jobId; RLS is what actually enforces both restrictions (CLAUDE.md's own
   * warning about a DEFINER function silently opting out of the verified
   * gate is precisely why this reuses the ambient client instead of reaching
   * for one). A missing job or a not-yet-computed score just means no job
   * context — the chat still works, ungrounded, rather than erroring.
   */
  let jobContext: string | undefined;
  if (jobId) {
    const [{ data: jobRow }, { data: scoreRow }] = await Promise.all([
      supabase.from("job_postings").select("title, company_name").eq("id", jobId).maybeSingle(),
      supabase
        .from("match_scores")
        .select("explanation")
        .eq("user_id", user.id)
        .eq("job_posting_id", jobId)
        .maybeSingle(),
    ]);
    if (jobRow && scoreRow?.explanation) {
      // Title, company and skill gaps come from the posting: labelled as data, never appended as plain prompt text.
      jobContext = labelAsData(
        "job_posting",
        buildJobContext({ title: jobRow.title, companyName: jobRow.company_name }, scoreRow.explanation as unknown as MatchExplanation),
      );
    }
  }

  const extraContext =
    [resumeContext, jobContext].filter((part): part is string => !!part).join("\n\n") || undefined;

  const turns: FarahChatTurn[] = [
    ...[...(historyRows ?? [])]
      .reverse()
      .map((row) => ({
        role: row.role === "farah" ? ("assistant" as const) : ("user" as const),
        // Truncated for the REPLAY only — the stored row and what the user
        // sees in the panel are untouched. A reply written under the old
        // 1536-token budget is still in farah_messages, so without this the
        // history term stays unbounded no matter what future replies cost.
        content: row.content.slice(0, MAX_HISTORY_MESSAGE_CHARS),
      })),
    { role: "user", content: message },
  ];

  /*
   * Streamed from here on (send-latency-1): everything above can still
   * fail with a plain JSON error response (bad input, rate-limited on
   * message count, entitlement gate) because none of it has committed to a
   * response body yet. Once we're actually calling the LLM, Farah's
   * free-text chat is the one call site in this codebase where streaming is
   * safe to show — see LLMProvider.generateTextStream's own comment on why
   * the JSON-schema calls (tailoring, gap analysis) don't get this. NDJSON
   * framing (one `{...}\n` object per line) rather than real SSE: the
   * client already needs to parse each event's payload, and NDJSON needs no
   * `data: `/blank-line framing to get that for free — it's simpler to
   * produce and to consume for a same-origin fetch stream with no third
   * party (a browser's native EventSource) that would need it.
   *
   * The allowance is committed, and both messages are persisted, only AFTER
   * the full reply has been collected — same rule as before streaming
   * existed (checkFarahChatAllowance's own header), extended the obvious
   * way: a reply that errors out PARTWAY through streaming is still a
   * failed call. The user already saw the partial text (that's inherent to
   * streaming — there's no way to un-send bytes already on the wire), but
   * it is deliberately not charged for and not saved, the same as any other
   * failed attempt.
   */
  // The reader has already gone (the request was aborted before a model call was made): nothing to answer, nothing to charge, nothing to save.
  if (request.signal.aborted) {
    return new Response(null, { status: 499 });
  }

  const encoder = new TextEncoder();
  /** Adds an estimate to today's counter. A failure to record is logged (content-free) and never turns a delivered reply into an error. */
  async function recordSpend(nano: number) {
    try {
      await addSpendNano(nano);
    } catch (err) {
      console.error(counterFailureLine(err));
    }
  }
  // Set when the reader goes away (the response stream is cancelled): the rest of the run can no longer be delivered, but the model call it started may still have cost something.
  let clientGone = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      clientGone = true;
    },
    async start(controller) {
      function send(event: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }

      let fullText = "";
      // Why the model stopped, as the provider reported it. Stays undefined when the provider never said, which
      // is treated as "finished": only a REAL length stop (the model hit the output ceiling) is an incomplete reply.
      let finishReason: LLMFinishReason | undefined;
      // The token counts the provider reported for this reply, if it reported any; saved on the reply row's JSON context below.
      let usage: LLMUsage | undefined;
      // Which provider and model served the reply, as the provider call reported it with its counts: the estimate is priced from this.
      let served: { provider: string; model: string } | undefined;
      try {
        for await (const chunk of askFarahChatStream(turns, extraContext, undefined, {
          quickAction,
          // The model call stops when the reader goes away; an aborted call ends in the error path below, which saves and charges nothing.
          signal: request.signal,
          // The ceiling is checked again, with a fresh read, just before the fallback provider would be used; a counter that cannot be read means no fallback.
          allowFallback: () => checkFallbackHeadroom({ read: readSpendNano }),
          onFinish: (reason) => {
            finishReason = reason;
          },
          onUsage: (u, s) => {
            usage = u;
            served = s;
          },
        })) {
          fullText += chunk;
          send({ type: "delta", text: chunk });
        }
      } catch (err) {
        // A model call that did not complete is added to today's counter at the flat failed-attempt estimate (most such calls bill nothing, so this is already pessimistic).
        // When the cause is the reader going away (the stream was cancelled, or the request's own signal fired: either can come first), that is the whole story: say so once, content-free, and stop (nothing can be sent).
        await recordSpend(FAILED_ATTEMPT_ESTIMATE_NANO);
        if (clientGone || request.signal.aborted) {
          console.warn("[farah-spend:aborted] flat estimate charged");
          try {
            controller.close();
          } catch {
            // the stream was already cancelled: nothing left to close
          }
          return;
        }
        // Never surface the raw provider error to the client — a provider
        // SDK's error .message can embed the full JSON response body
        // (internal request details, account-billing detail, etc.), which
        // is both leaky and useless to a user. Log server-side for
        // debugging (LLMProviderError — src/lib/llm/errors.ts — carries
        // which provider and what kind of failure), send a clean,
        // Farah-voiced message instead.
        if (err instanceof FallbackDeclinedError) {
          // The primary was rate-limited and there is not enough headroom left for the fallback: end the reply with the busy wording (nothing was charged). Content-free line.
          console.warn("[farah-spend:fallback-declined] the fallback provider was not used: the day's headroom is below its reserve");
          send({ type: "error", message: FARAH_BUSY_MESSAGE });
          controller.close();
          return;
        }
        console.error("Farah chat: LLM call failed", err);
        // send-111: a rate-limit error carries Groq's own real wait time —
        // use it instead of the generic message. Any other LLMProviderError
        // kind (or a non-LLM error) keeps the generic copy unchanged.
        const errorMessage =
          err instanceof LLMProviderError && err.kind === "rate_limit"
            ? farahRateLimitMessage(err.message)
            : GENERIC_FARAH_UNAVAILABLE_MESSAGE;
        send({ type: "error", message: errorMessage });
        controller.close();
        return;
      }

      // The model call completed: add its estimated cost, from the provider's reported counts (priced at the dearest known row if the model is unknown), or at the worst-case flat estimate when no counts came.
      if (fullText) {
        await recordSpend(
          usage
            ? estimateSpendNano({ provider: served?.provider, model: served?.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
            : NO_COUNTS_REPLY_ESTIMATE_NANO,
        );
      } else {
        await recordSpend(FAILED_ATTEMPT_ESTIMATE_NANO);
      }

      if (!fullText) {
        // A provider that streams zero chunks and never throws — treated
        // the same as the pre-streaming "empty response" case each
        // provider's own generateWithUsage already guards against, just
        // reached a different way here.
        send({ type: "error", message: GENERIC_FARAH_UNAVAILABLE_MESSAGE });
        controller.close();
        return;
      }

      /*
       * A reply that stopped because it hit the output ceiling is cut off mid-thought, and is NOT a complete
       * answer — so it is not charged, and does not use up a free message or a Pass's daily slot (send-500).
       * The owner paid a credit for a reply that ended "I'm a FinTech Product Manager with". It is still shown
       * (the user already read it as it streamed) and still saved, marked truncated, so nothing they saw
       * disappears; the client tells them it was cut off and cost nothing.
       *
       * Why not "continue it" with a second call instead: that replays the whole prompt and history again for
       * one user action, and Farah's production failure mode is the provider's per-minute token cap (send-109,
       * token-budget.ts). Not charging is deterministic and adds no cost. Trade-off: someone could try to
       * provoke length stops for free replies; the hourly message cap still counts their saved messages, and
       * the reply-size instruction (chat-prompt.ts) makes a length stop the exception.
       */
      const truncated = finishReason === "length";

      // Only now — after the LLM call actually succeeded in full — commit
      // the free allowance/Pass use or the credit spend. See
      // checkFarahChatAllowance's own header for why this can't happen any
      // earlier. Skipped for a cut-off reply, above.
      const committed = truncated ? undefined : await commitFarahChatAllowance(user.id, allowance);
      // The new balance for a paid message; null when nothing was spent (issue #605).
      const creditsBalance = committed?.balanceAfter ?? null;
      // The free-message count the gate reported is "left AFTER this one"; a cut-off message used none, so the
      // count the user sees must be the one from before it.
      const freeMessagesRemaining =
        truncated && allowance.isFreeAllowance && allowance.freeMessagesRemaining !== null
          ? allowance.freeMessagesRemaining + 1
          : allowance.freeMessagesRemaining;
      // When the next free message comes back, for the panel's line: only when the free messages are used up and no Pass covers this message (read AFTER the commit, so a message that just used the last one counts).
      // Display-only: null in every other case without a read, and a failed read is null; it never blocks the reply or changes a charge.
      let nextFreeMessageAt: string | null = null;
      if (!allowance.isPassCovered && freeMessagesRemaining === 0) {
        try {
          nextFreeMessageAt = await farahChatNextFreeMessageAt(user.id);
        } catch {
          nextFreeMessageAt = null;
        }
      }
      const rowContext = truncated ? { ...context, truncated: true } : context;
      // The reply row (only) also carries the token counts, so daily totals can be summed from saved rows: runtime logs are kept about an hour.
      // No migration: `context` is the existing JSON column. Absent when the provider reported none (unknown is not zero).
      const replyContext = usage ? { ...rowContext, tokens: { prompt: usage.inputTokens, completion: usage.outputTokens } } : rowContext;

      // Message history is written by the server only (see saveFarahExchange); this route's own client only reads.
      const saved = await saveFarahExchange({ userId: user.id, message, reply: fullText, userRowContext: rowContext, replyRowContext: replyContext });

      if (!saved) {
        // The reply already happened and cost real money — the client
        // already has the full text from the delta events either way; this
        // just tells it persistence failed, rather than losing the answer.
        send({
          type: "done",
          id: null,
          createdAt: new Date().toISOString(),
          persisted: false,
          freeMessagesRemaining,
          nextFreeMessageAt,
          creditsBalance,
          ...(truncated ? { truncated: true } : {}),
        });
      } else {
        send({
          type: "done",
          id: saved.id,
          createdAt: saved.createdAt,
          persisted: true,
          freeMessagesRemaining,
          nextFreeMessageAt,
          creditsBalance,
          ...(truncated ? { truncated: true } : {}),
        });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
