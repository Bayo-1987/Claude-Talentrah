"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, BorderedCard, EyebrowLabel } from "@/components/ui";
import { createResumeAction } from "@/lib/resume-builder/actions";
import { ResumeUpload } from "@/components/onboarding/resume-upload";
import type { StructuredResume } from "@/lib/resume/types";

/**
 * The founder's framing for why this screen exists at all: "Canva and Enhancv
 * open a filled document the user edits... that difference is what users are
 * describing when they say they prefer [them]." Three panels, one choice,
 * made BEFORE the empty form ever appears.
 *
 * Each panel is a real `<form action={createResumeAction.bind(...)}>` —
 * see that action's doc comment (src/lib/resume-builder/actions.ts) for why
 * even the upload path goes through a form submit rather than a direct call.
 */
export function StartStateChooser({
  templateId,
  templateName,
  hasBaseResume,
}: {
  templateId: string;
  templateName: string;
  hasBaseResume: boolean;
}) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <EyebrowLabel>New resume — {templateName}</EyebrowLabel>
        <h1 className="mt-2 font-display text-[26px]">How do you want to start?</h1>
        <p className="mt-1 text-[14.5px] text-ink-soft">
          Pick whichever gets you to real content fastest — you can change anything once you&apos;re in the editor.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <ImportPanel templateId={templateId} hasBaseResume={hasBaseResume} />
        <ExamplePanel templateId={templateId} />
        <BlankPanel templateId={templateId} />
      </div>

      <Link
        href="/resume-builder"
        className="text-[13.5px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
      >
        ← Back to templates
      </Link>
    </div>
  );
}

function PanelShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <BorderedCard className="flex flex-col gap-3 p-5">
      <EyebrowLabel size="sm">{eyebrow}</EyebrowLabel>
      <h3 className="text-[16px]">{title}</h3>
      <p className="flex-1 text-[13.5px] text-ink-soft">{description}</p>
      {children}
    </BorderedCard>
  );
}

function BlankPanel({ templateId }: { templateId: string }) {
  return (
    <PanelShell
      eyebrow="Start blank"
      title="A blank form"
      description="Fill in every section yourself, from nothing. Good if none of the shortcuts fit."
    >
      <form action={createResumeAction.bind(null, templateId, "blank")}>
        <Button size="sm" type="submit" variant="secondary">
          Start blank
        </Button>
      </form>
    </PanelShell>
  );
}

function ExamplePanel({ templateId }: { templateId: string }) {
  return (
    <PanelShell
      eyebrow="Start from an example"
      title="A filled example"
      description="Open a complete, realistic CV in this template and edit it into your own — swap out the wording instead of writing it from scratch."
    >
      <form action={createResumeAction.bind(null, templateId, "example")}>
        <Button size="sm" type="submit" variant="secondary">
          Use the example
        </Button>
      </form>
    </PanelShell>
  );
}

type ImportMode = "choose" | "upload" | "parsed";

function ImportPanel({ templateId, hasBaseResume }: { templateId: string; hasBaseResume: boolean }) {
  const [mode, setMode] = useState<ImportMode>(hasBaseResume ? "choose" : "upload");
  const [parsed, setParsed] = useState<{ resume: StructuredResume; confidence: "high" | "low" } | null>(null);

  return (
    <PanelShell
      eyebrow="Import my CV"
      title="Your own resume"
      description="Bring in your existing resume and style it in this template."
    >
      {mode === "choose" && (
        <div className="flex flex-col gap-2">
          <form action={createResumeAction.bind(null, templateId, "import_base")}>
            <Button size="sm" type="submit">
              Use my existing resume
            </Button>
          </form>
          <button
            type="button"
            onClick={() => setMode("upload")}
            className="text-left text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
          >
            Upload a different file instead
          </button>
        </div>
      )}

      {mode === "upload" && (
        <div className="flex flex-col gap-2">
          <ResumeUpload
            endpoint="/api/resume-builder/import"
            heading="Upload your resume (PDF, DOCX, or plain text) — Farah will pull in your details so you can style them."
            showSkip={false}
            onParsed={(result) => {
              setParsed(result);
              setMode("parsed");
            }}
          />
          {hasBaseResume && (
            <button
              type="button"
              onClick={() => setMode("choose")}
              className="text-left text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
            >
              ← Use my existing resume instead
            </button>
          )}
        </div>
      )}

      {mode === "parsed" && parsed && (
        <div className="flex flex-col gap-3">
          <p className="text-[13.5px] text-ink-soft">
            Farah found {parsed.resume.skills.length} skill
            {parsed.resume.skills.length === 1 ? "" : "s"} and {parsed.resume.experience.length}{" "}
            work experience {parsed.resume.experience.length === 1 ? "entry" : "entries"}.
            {parsed.confidence === "low" &&
              " Some sections weren't clear — you'll be able to fill in the gaps in the editor."}
          </p>
          <form action={createResumeAction.bind(null, templateId, "import_upload")}>
            <input type="hidden" name="content" value={JSON.stringify(parsed.resume)} />
            <Button size="sm" type="submit">
              Use this
            </Button>
          </form>
          <button
            type="button"
            onClick={() => {
              setParsed(null);
              setMode("upload");
            }}
            className="text-left text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
          >
            Try a different file
          </button>
        </div>
      )}
    </PanelShell>
  );
}
