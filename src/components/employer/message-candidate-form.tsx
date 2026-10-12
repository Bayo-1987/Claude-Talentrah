"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { sendApplicantMessageAction } from "@/lib/employer/applicant-message-actions";
import { MESSAGE_TEMPLATE_KINDS, TEMPLATE_LABELS, SUBJECT_MAX, BODY_MAX, type MessageTemplateKind } from "@/lib/employer/applicant-messages/constants";
import { cn } from "@/lib/cn";
import { TextArea } from "@/components/ui/text-area";

export type TemplateTexts = Record<MessageTemplateKind, { subject: string; body: string }>;

/**
 * The Message candidate form (0256): pick a starting template or write from scratch, edit, press Send. Nothing is sent until Send. The candidate's address is never on this
 * page: the server resolves it, and the text says where replies go (the employer's own address, passed in as `replyTo`).
 */
export function MessageCandidateForm({
  jobId,
  applicationId,
  candidateName,
  jobTitle,
  orgName,
  replyTo,
  templates,
  remainingToday,
  backHref,
  premium,
  farahPriceNgn,
  orgVerified,
}: {
  jobId: string;
  applicationId: string;
  candidateName: string;
  jobTitle: string;
  orgName: string;
  replyTo: string;
  templates: TemplateTexts;
  remainingToday: number;
  backHref: string;
  /** Server-decided (organization_premium): the form only chooses what to show; the action refuses a free plan on its own. */
  premium: boolean;
  farahPriceNgn: number;
  /** Only a verified company may send (the action refuses otherwise); the form says so up front instead of letting them write a message that cannot go. */
  orgVerified: boolean;
}) {
  const [kind, setKind] = useState<MessageTemplateKind | "custom">("custom");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [lastTemplate, setLastTemplate] = useState<{ subject: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const [remaining, setRemaining] = useState(remainingToday);
  const [pending, startTransition] = useTransition();
  const [notes, setNotes] = useState("");
  const [drafted, setDrafted] = useState(false);
  const [farahError, setFarahError] = useState<string | null>(null);
  const [farahPending, startFarah] = useTransition();
  // Synchronous re-entry guards: a double click fires two click events before React has re-rendered the disabled button, and each would charge the wallet or send the message.
  const farahBusy = useRef(false);
  const sendBusy = useRef(false);

  const edited = (subject !== (lastTemplate?.subject ?? "") || body !== (lastTemplate?.body ?? "")) && (subject !== "" || body !== "");

  function applyTemplate(next: MessageTemplateKind) {
    if (edited && !window.confirm("Replace what you've written with this template?")) return;
    const text = templates[next];
    setKind(next);
    setSubject(text.subject);
    setBody(text.body);
    setLastTemplate(text);
    setError(null);
  }

  function askFarah() {
    if (farahBusy.current) return;
    farahBusy.current = true;
    setFarahError(null);
    const hasText = subject.trim() !== "" || body.trim() !== "";
    startFarah(async () => {
      try {
        // A route handler, not a Server Action: a draft the browser disconnects before receiving is refunded (see the route).
        const response = await fetch("/api/employer/applicant-message-draft", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jobId, applicationId, kind, mode: hasText ? "refine" : "draft", notes, subject, body }),
        });
        const result = (await response.json()) as { ok: true; subject: string; body: string } | { ok: false; error: string };
        if (result.ok) {
          setSubject(result.subject);
          setBody(result.body);
          setLastTemplate(null);
          setDrafted(true);
        } else {
          // A refusal or a failed draft changes nothing the employer typed, and a failed draft has been refunded.
          setFarahError(result.error);
        }
      } catch {
        setFarahError("Couldn't reach Farah. Check your connection and try again. You were not charged unless the draft appears.");
      } finally {
        farahBusy.current = false;
      }
    });
  }

  function send() {
    if (sendBusy.current) return;
    sendBusy.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await sendApplicantMessageAction({ jobId, applicationId, kind, subject, body });
        if (result.ok) {
          setRemaining(result.remaining);
          setSentCount((n) => n + 1);
          setSubject("");
          setBody("");
          setLastTemplate(null);
          setKind("custom");
          setDrafted(false);
        } else {
          // The message stays in the boxes: a refusal never costs the employer what they wrote.
          setError(result.error);
        }
      } catch {
        setError("Couldn't send just now. Check your connection and try again: your message is still here.");
      } finally {
        sendBusy.current = false;
      }
    });
  }

  const full = remaining <= 0;
  const cannotSend = full || !orgVerified;

  return (
    <div className="border-[1.5px] border-ink bg-card p-6 sm:p-8">
      <h1 className="font-display text-[28px] leading-[1.15] font-medium text-ink">Message {candidateName}</h1>
      <p className="mt-2 max-w-[62ch] font-body text-[14px] text-ink-soft">
        About: {jobTitle}. Their reply comes to your email ({replyTo}). Their address stays private.
      </p>

      {!orgVerified && (
        <p role="status" className="mt-5 border-[1.5px] border-amber bg-[oklch(96%_0.03_70)] px-4 py-3 font-body text-[13.5px] text-ink">
          <span className="font-semibold">Verify your company first.</span> Messages to candidates are sent from Talentrah, so only verified companies can send them.{" "}
          <Link href="/employer/profile" className="font-semibold underline underline-offset-2 hover:text-rust">
            Go to Company Profile
          </Link>
        </p>
      )}

      {sentCount > 0 && (
        <p role="status" className="mt-5 border-[1.5px] border-ink bg-paper-alt px-4 py-3 font-body text-[14px] text-ink">
          Message sent. It is logged on this application.{" "}
          <Link href={backHref} className="font-semibold underline underline-offset-2 hover:text-rust">
            Back to applicants
          </Link>
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Start from a template">
        {MESSAGE_TEMPLATE_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => applyTemplate(k)}
            aria-pressed={kind === k}
            className={cn(
              "min-h-11 border-[1.5px] border-line bg-paper-alt px-4 font-body text-[14px] font-semibold text-ink hover:border-rust hover:text-rust",
              kind === k && "border-ink",
            )}
          >
            {TEMPLATE_LABELS[k]}
          </button>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-1.5">
        <label htmlFor="message-subject" className="font-body text-[13px] font-semibold text-ink">
          Subject
        </label>
        <input
          id="message-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={SUBJECT_MAX}
          className="min-h-11 border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none focus:border-rust"
        />
      </div>

      <div className="mt-5 flex flex-col gap-1.5">
        <TextArea
          id="message-body"
          label="Message"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          limit={BODY_MAX}
          minRows={12}
          help="Plain text only. A link you type is sent as text, not as a link."
        />
      </div>

      {premium ? (
        <div className="mt-5 border-[1.5px] border-rust bg-rust-soft p-4">
          {drafted && (
            <p className="font-body text-[14px] text-ink">
              <span className="font-semibold text-rust">Farah</span> drafted this from your notes and the job. Review it before sending.
            </p>
          )}
          <TextArea
            id="farah-notes"
            label="Notes for Farah (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            limit={2000}
            counterFrom={1500}
            placeholder="What should the message say? Farah only uses what you write here."
            wrapperClassName={drafted ? "mt-3" : undefined}
          />
          {farahError && (
            <p role="alert" className="mt-3 font-body text-[13.5px] text-rust">
              {farahError}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={askFarah}
              disabled={farahPending || pending}
              className="min-h-11 border-[1.5px] border-rust bg-card px-5 font-body text-[14px] font-semibold text-rust hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50"
            >
              {farahPending ? "Farah is writing…" : subject.trim() || body.trim() ? "Refine with Farah" : "Draft with Farah"}
            </button>
            <p className="font-body text-[12.5px] text-ink-soft">
              {`₦${farahPriceNgn.toLocaleString("en-NG")}`} from your ad wallet per draft; refunded if Farah can&apos;t produce one. Farah never sends anything.
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border border-dashed border-ink-soft px-4 py-3">
          <p className="font-body text-[14px] text-ink-soft">Draft or refine with Farah is part of Premium.</p>
          <Link href="/contact?topic=premium" className="inline-flex min-h-11 items-center border-[1.5px] border-ink bg-card px-5 font-body text-[14px] font-semibold text-ink hover:border-rust hover:text-rust">
            See Premium
          </Link>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-5 border-[1.5px] border-rust bg-rust-soft px-4 py-3 font-body text-[13.5px] text-rust">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-[44ch] font-body text-[13px] text-ink-soft">
          Sent by Talentrah for {orgName}. Logged on this application. {full ? "No messages left today." : `${remaining} of 20 messages left today.`}
        </p>
        <button
          type="button"
          onClick={send}
          disabled={pending || farahPending || cannotSend || !subject.trim() || !body.trim()}
          className="min-h-12 bg-ink px-7 font-body text-[15px] font-semibold text-paper hover:bg-rust disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send message"}
        </button>
      </div>
    </div>
  );
}
