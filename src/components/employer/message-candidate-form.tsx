"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { sendApplicantMessageAction } from "@/lib/employer/applicant-message-actions";
import { MESSAGE_TEMPLATE_KINDS, TEMPLATE_LABELS, SUBJECT_MAX, BODY_MAX, type MessageTemplateKind } from "@/lib/employer/applicant-messages/constants";
import { cn } from "@/lib/cn";

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
}) {
  const [kind, setKind] = useState<MessageTemplateKind | "custom">("custom");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [lastTemplate, setLastTemplate] = useState<{ subject: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const [remaining, setRemaining] = useState(remainingToday);
  const [pending, startTransition] = useTransition();

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

  function send() {
    setError(null);
    startTransition(async () => {
      const result = await sendApplicantMessageAction({ jobId, applicationId, kind, subject, body });
      if (result.ok) {
        setRemaining(result.remaining);
        setSentCount((n) => n + 1);
        setSubject("");
        setBody("");
        setLastTemplate(null);
        setKind("custom");
      } else {
        // The message stays in the boxes: a refusal never costs the employer what they wrote.
        setError(result.error);
      }
    });
  }

  const full = remaining <= 0;

  return (
    <div className="border-[1.5px] border-ink bg-card p-6 sm:p-8">
      <h1 className="font-display text-[28px] leading-[1.15] font-medium text-ink">Message {candidateName}</h1>
      <p className="mt-2 max-w-[62ch] font-body text-[14px] text-ink-soft">
        About: {jobTitle}. Their reply comes to your email ({replyTo}). Their address stays private.
      </p>

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
        <label htmlFor="message-body" className="font-body text-[13px] font-semibold text-ink">
          Message
        </label>
        <textarea
          id="message-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={BODY_MAX}
          rows={12}
          className="border-[1.5px] border-ink bg-card px-3.5 py-3 font-body text-[15px] leading-[1.6] text-ink outline-none focus:border-rust"
        />
        <p className="font-body text-[12.5px] text-ink-soft">Plain text only. A link you type is sent as text, not as a link.</p>
      </div>

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
          disabled={pending || full || !subject.trim() || !body.trim()}
          className="min-h-12 bg-ink px-7 font-body text-[15px] font-semibold text-paper hover:bg-rust disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send message"}
        </button>
      </div>
    </div>
  );
}
