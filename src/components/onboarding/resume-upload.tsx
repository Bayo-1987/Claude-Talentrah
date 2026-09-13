"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, EyebrowLabel } from "@/components/ui";
import type { StructuredResume } from "@/lib/resume/types";

type Status = "idle" | "uploading" | "done" | "error";

export interface ResumeUploadProps {
  /**
   * Where the two exits go — normally the feed, but a signup that began from
   * a shared job link carries that job's path through here. Onboarding is
   * not skippable, so it has to hand the destination on rather than swallow
   * it; without this the whole redirectTo chain dies one hop from the end.
   *
   * Already validated by the page (safeRedirectTo) — this component does not
   * re-check, and must not be handed a raw query value.
   *
   * Ignored when `onParsed` is given — that caller handles navigation itself.
   */
  next?: string;
  /**
   * Which route to POST the file to. Defaults to /api/resume/parse (the
   * onboarding path, which writes the parsed content as the user's
   * is_base=true resume via upsertBaseResume). The Resume Builder's "Import
   * my CV" flow passes /api/resume-builder/import instead — a route that
   * parses but never writes anywhere, so importing a CV to style it never
   * silently repoints the canonical base resume Auto-Apply submits.
   */
  endpoint?: string;
  /**
   * When given, a successful parse calls this instead of rendering the
   * built-in "Resume saved" / "Continue" screen and navigating to `next`.
   * The Resume Builder uses this to take the parsed content straight into
   * createResumeAction rather than treating the upload itself as a
   * destination.
   */
  onParsed?: (result: { resume: StructuredResume; confidence: "high" | "low" }) => void;
  /** Copy shown above the upload control, while idle. */
  heading?: string;
  /** Set false to hide the "Skip for now" exit — the builder's chooser has
   *  its own way back (a different start-state panel), so it doesn't need a
   *  second one baked into this component. */
  showSkip?: boolean;
  /**
   * Run before navigating away from the skip control, if the surface wants a
   * skip recorded.
   *
   * A PROP RATHER THAN AN IMPORT, so the scoping is structural. This component
   * is shared with the resume builder's start-state chooser, and only
   * /onboarding is a place where "skip" means "I was offered onboarding and
   * declined". Reaching for the Server Action directly from inside here would
   * make that true by accident — it happens to hold today only because the
   * builder passes `showSkip={false}`, which is one prop change away from
   * silently recording a skip that never happened. A surface that wants the
   * marker written has to say so.
   */
  onSkip?: () => Promise<void>;
}

export function ResumeUpload({
  next = "/jobs",
  endpoint = "/api/resume/parse",
  onParsed,
  onSkip,
  heading = "Upload your resume (PDF, DOCX, or plain text) and Farah will pre-fill your profile.",
  showSkip = true,
}: ResumeUploadProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    resume: StructuredResume;
    confidence: "high" | "low";
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleFile(file: File) {
    setStatus("uploading");
    setError(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        setStatus("error");
        return;
      }
      if (onParsed) {
        onParsed({ resume: data.resume, confidence: data.confidence });
        setStatus("done");
        return;
      }
      setResult({ resume: data.resume, confidence: data.confidence });
      setStatus("done");
    } catch {
      setError("Upload failed — check your connection and try again.");
      setStatus("error");
    }
  }

  if (status === "done" && result) {
    const { resume, confidence } = result;
    return (
      <div className="flex flex-col gap-4 border-[1.5px] border-ink bg-card p-5">
        <EyebrowLabel size="sm">Resume saved</EyebrowLabel>
        <p className="text-[14px] text-ink-soft">
          Farah found {resume.skills.length} skill
          {resume.skills.length === 1 ? "" : "s"} and {resume.experience.length}{" "}
          work experience {resume.experience.length === 1 ? "entry" : "entries"}.
          {confidence === "low" &&
            " Some sections weren't clear — you can fill in the gaps later in the Resume Builder."}
        </p>
        <Button onClick={() => router.push(next)}>
          Continue to your dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-[1.5px] border-dashed border-line p-6 text-center">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.txt"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <p className="text-[14px] text-ink-soft">
        {status === "uploading" ? "Farah is reading your resume…" : heading}
      </p>
      {error && <p className="text-[13px] text-coral">{error}</p>}
      <div className="mt-1 flex items-center justify-center gap-4">
        <Button
          type="button"
          size="sm"
          disabled={status === "uploading"}
          onClick={() => inputRef.current?.click()}
        >
          {status === "uploading" ? "Uploading…" : "Choose a file"}
        </Button>
        {showSkip && (
          <button
            type="button"
            /*
             * SET, THEN NAVIGATE. Awaited rather than fired off, because a
             * navigation can tear down the request that carries the write —
             * and a skip that is not recorded sends this same person straight
             * back here on their next sign-in, which is the whole thing the
             * marker prevents.
             *
             * The navigation is NOT conditional on the write succeeding. The
             * action logs its own failure; the person asked to leave, and the
             * cost of a lost write is seeing this screen once more, which is
             * strictly better than being held on it.
             */
            onClick={async () => {
              await onSkip?.();
              router.push(next);
            }}
            className="text-[13.5px] font-semibold text-ink-soft underline underline-offset-2 hover:text-coral"
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}
