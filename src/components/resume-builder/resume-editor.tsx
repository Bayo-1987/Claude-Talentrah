"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, TextField, EyebrowLabel, BorderedCard } from "@/components/ui";
import { saveResumeAction, rewriteBulletAction } from "@/lib/resume-builder/actions";
import { useReportCreditsBalance } from "@/components/app-shell/credits-balance";
import { findUneditedExampleFields } from "@/lib/resume-builder/example-guard";
import {
  bulletsPatch,
  canTurnOffBullets,
  experienceBulletParagraphs,
} from "@/lib/resume-builder/achievements-editor";
import { TemplateRenderer } from "@/components/resume-builder/templates";
import { PrintButton } from "@/components/resume-builder/print-button";
import { ResumePrintSurface } from "@/components/resume-builder/resume-print-surface";
import { useUnsavedGuard } from "@/components/resume-builder/use-unsaved-guard";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { chargeAnnouncement, creditsPhrase, priced } from "@/lib/credits/price-labels";
import { MinimalRichEditor } from "@/components/rich-text/minimal-rich-editor";
import { TextArea } from "@/components/ui/text-area";
import { MinimalRichEditorList } from "@/components/rich-text/minimal-rich-editor-list";
import {
  getExperienceBullets,
  type StructuredResume,
  type ResumeExperienceEntry,
  type ResumeEducationEntry,
  type ResumeLink,
  type ResumeLanguage,
  type ResumeVolunteeringEntry,
  type ResumeCustomSection,
} from "@/lib/resume/types";

/**
 * The textarea's own display value for an experience entry: `bullets`
 * joined one-per-line when they exist (so a role parsed or tailored with
 * real bullets is actually visible and editable, not hidden behind a blank
 * field because `description` was never set for it), falling back to
 * `description` otherwise — the same precedence `getExperienceText` uses,
 * just joined with a newline instead of a space since this feeds an
 * editable multi-line field rather than a rendered paragraph.
 */
function experienceTextareaValue(entry: ResumeExperienceEntry): string {
  const bullets = getExperienceBullets(entry);
  return bullets ? bullets.join("\n") : (entry.description ?? "");
}

/**
 * Turns whatever's in the textarea into the patch to apply to an entry.
 * `description` always gets the raw text — the textarea's own source of
 * truth, so re-rendering with this same value back never trims a trailing
 * space or eats a blank line the user just pressed Enter to create.
 * `bullets` is DERIVED separately (split on newline, trimmed, blanks
 * dropped) and only set when there's genuinely more than one line; a
 * single-line entry keeps `bullets` undefined so `getExperienceText`'s
 * existing bullets-then-description fallback renders it as plain text, not
 * a one-item bulleted list.
 */
function narrativePatch(rawText: string): { description: string; bullets: string[] | undefined } {
  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return { description: rawText, bullets: lines.length > 1 ? lines : undefined };
}

// send-370 Part B: the Achievements field's paragraph-per-bullet rules —
// experienceBulletParagraphs / bulletsPatch / canTurnOffBullets — live in
// lib/resume-builder/achievements-editor.ts so they can be unit-tested.

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const copy = [...arr];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

function DragHandle() {
  return (
    <div
      aria-label="Drag to reorder"
      title="Drag to reorder"
      className="flex h-9 w-9 shrink-0 cursor-grab items-center justify-center text-ink-soft active:cursor-grabbing"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
        <circle cx="4" cy="3" r="1.3" />
        <circle cx="10" cy="3" r="1.3" />
        <circle cx="4" cy="7" r="1.3" />
        <circle cx="10" cy="7" r="1.3" />
        <circle cx="4" cy="11" r="1.3" />
        <circle cx="10" cy="11" r="1.3" />
      </svg>
    </div>
  );
}

function RemoveControl({ onRemove }: { onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label="Remove"
      className="flex h-9 w-9 shrink-0 items-center justify-center text-ink-soft hover:text-rust"
    >
      ×
    </button>
  );
}

/**
 * Caption for a field/card/section still carrying "Start from an example"
 * placeholder content — the same visual language as TextField's own `error`
 * caption (text-[12.5px] text-rust), hand-matched here for fields that don't
 * go through TextField. See example-guard.ts for what "still the example"
 * means and PrintButton for the export block this same signal feeds.
 */
function ExampleFlagNotice({ text }: { text: string }) {
  return <p className="text-[12.5px] text-rust">{text}</p>;
}

type RewriteInstruction = "impact" | "quantify" | "concise";

const REWRITE_CONTROLS: { instruction: RewriteInstruction; label: string }[] = [
  { instruction: "impact", label: "More impact-driven" },
  { instruction: "quantify", label: "Quantify this" },
  { instruction: "concise", label: "More concise" },
];

/**
 * The three Farah rewrite controls, each carrying its price (send-493). `min-h-11` is the 44px hit target the
 * design system asks for: these were 18px-tall underlined links. `passCovered` swaps the credit price for
 * "included with your Pass" so a covered account is never shown a price it will not pay.
 */
export function RewriteButtons({
  onRewrite,
  passCovered = false,
  disabled = false,
}: {
  onRewrite: (instruction: RewriteInstruction) => void;
  passCovered?: boolean;
  /** While a rewrite is waiting on Keep/Discard: a second one would replace a paid result nobody has decided on. */
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 text-[13px]">
      <span className="font-semibold text-ink-soft">Farah:</span>
      {REWRITE_CONTROLS.map(({ instruction, label }) => (
        <button
          key={instruction}
          type="button"
          disabled={disabled}
          onClick={() => onRewrite(instruction)}
          className="inline-flex min-h-11 items-center underline underline-offset-2 text-ink-soft hover:text-rust disabled:cursor-not-allowed disabled:opacity-50"
        >
          {priced(label, CREDIT_COSTS.bulletRewrite, passCovered)}
        </button>
      ))}
    </div>
  );
}

/** A generated rewrite waiting for the user's decision. The editor text is NOT changed until Keep. */
interface PendingRewrite {
  index: number;
  text: string;
  /** Credits this generation took (0 when a Pass covered it). Already spent — Discard cannot give them back. */
  credits: number;
}

export interface ResumeEditorProps {
  resumeId: string;
  initialTitle: string;
  initialContent: StructuredResume;
  /** Which template's layout to render in the live preview — the same slug
   *  the (removed) separate preview page used to read via a join. Passed
   *  through as-is to TemplateRenderer, which already falls back to the
   *  default layout for null/unmapped slugs. */
  templateSlug: string | null;
  /**
   * An active Pass covers bullet rewrites right now (checkPassCoverage, read by the page). Only changes what
   * the rewrite controls SAY; whether a rewrite is charged is decided by rewriteBulletAction, unchanged.
   */
  passCovered?: boolean;
}

export function ResumeEditor({ resumeId, initialTitle, initialContent, templateSlug, passCovered = false }: ResumeEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState<StructuredResume>(initialContent);
  const [rewritingKey, setRewritingKey] = useState<string | null>(null);
  const [rewriteError, setRewriteError] = useState<string | null>(null);
  const [rewriteErrorKey, setRewriteErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /*
   * "Has the user changed something since load or the last Save". NOT the inverse of `saved`: `saved` starts
   * false on a freshly opened, untouched resume (the button reads "Save"), so using it would warn people who
   * changed nothing.
   */
  const [dirty, setDirty] = useState(false);
  const [pendingRewrite, setPendingRewrite] = useState<PendingRewrite | null>(null);
  const [announcement, setAnnouncement] = useState<{ index: number; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [dragExperienceIndex, setDragExperienceIndex] = useState<number | null>(null);
  const [dragEducationIndex, setDragEducationIndex] = useState<number | null>(null);
  // MinimalRichEditor is uncontrolled (TipTap's own document is the source
  // of truth once mounted, same as RichMarkdownEditor) — bumping this key
  // forces a remount so an EXTERNAL change to content.summary (only
  // "Clear example content?" below causes one; the editor's own typing
  // never does) actually reaches the editor instead of being silently
  // ignored by React's own "same key, don't recreate" rule.
  const [summaryEditorKey, setSummaryEditorKey] = useState(0);
  const router = useRouter();
  const reportCreditsBalance = useReportCreditsBalance();

  // Recomputed from `content` every render — the same driftless signal
  // PrintButton derives independently from the same content, at the field
  // (contact/summary), card (experience/education entry) and section
  // (skills/projects/certifications) granularity the guard actually flags
  // at. See example-guard.ts's own header for why this is a live
  // computation rather than a stored flag.
  const flaggedPaths = new Set(findUneditedExampleFields(content).map((f) => f.path));

  // A rewrite waiting on Keep/Discard is paid-for work that exists nowhere but here, so it counts too.
  useUnsavedGuard(
    dirty || pendingRewrite !== null,
    "You have unsaved changes to this resume, including a paid rewrite not yet kept or saved. Leave anyway?",
  );

  function update<K extends keyof StructuredResume>(key: K, value: StructuredResume[K]) {
    setContent((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setDirty(true);
  }

  async function handleRewrite(index: number, instruction: RewriteInstruction) {
    const key = `${index}`;
    setRewritingKey(key);
    setRewriteError(null);
    setRewriteErrorKey(null);
    setAnnouncement(null);
    try {
      // Rewrites the WHOLE field, same as before an entry could hold more
      // than one bullet — see rewrite-bullet.ts's own header for why this
      // targets the full set rather than a single focused line.
      const { text, error, creditsBalance } = await rewriteBulletAction(
        experienceTextareaValue(content.experience[index]),
        instruction,
      );
      if (error) {
        setRewriteError(error);
        setRewriteErrorKey(key);
        return;
      }
      /*
       * The credits are ALREADY SPENT here: rewriteBulletAction takes the charge when the rewrite is generated
       * (after the model call succeeds), not when it is applied. That is unchanged by the preview below, and
       * the preview says so rather than implying Discard is free. A paid rewrite: tell the masthead its new
       * balance (issue #605). Absent = nothing was spent (Pass-covered).
       */
      const credits = typeof creditsBalance === "number" ? CREDIT_COSTS.bulletRewrite : 0;
      if (typeof creditsBalance === "number") reportCreditsBalance(creditsBalance);
      setPendingRewrite({ index, text, credits });
      setAnnouncement({ index, text: chargeAnnouncement("Rewritten", credits) });
    } finally {
      setRewritingKey(null);
    }
  }

  function keepRewrite() {
    if (!pendingRewrite) return;
    const { index, text } = pendingRewrite;
    if (!content.experience[index]) {
      setPendingRewrite(null);
      setRewriteError("That entry changed while the rewrite was waiting, so it was not applied.");
      setRewriteErrorKey(`${index}`);
      return;
    }
    const next = [...content.experience];
    next[index] = { ...next[index], ...narrativePatch(text) };
    update("experience", next);
    setPendingRewrite(null);
    setAnnouncement({ index, text: "Rewrite kept — no further charge" });
  }

  function discardRewrite() {
    if (!pendingRewrite) return;
    // Nothing to restore: the editor text was never changed. The charge was taken at generation and stays.
    setAnnouncement({ index: pendingRewrite.index, text: "Rewrite discarded — your original text is unchanged" });
    setPendingRewrite(null);
  }

  function handleSave() {
    startTransition(async () => {
      await saveResumeAction(resumeId, content, title);
      setSaved(true);
      setDirty(false);
    });
  }

  const updateExperience = (index: number, patch: Partial<ResumeExperienceEntry>) => {
    const next = [...content.experience];
    next[index] = { ...next[index], ...patch };
    update("experience", next);
  };

  function handleExperienceDrop(targetIndex: number) {
    if (dragExperienceIndex === null || dragExperienceIndex === targetIndex) return;
    update("experience", moveItem(content.experience, dragExperienceIndex, targetIndex));
    setDragExperienceIndex(null);
  }

  function handleEducationDrop(targetIndex: number) {
    if (dragEducationIndex === null || dragEducationIndex === targetIndex) return;
    update("education", moveItem(content.education, dragEducationIndex, targetIndex));
    setDragEducationIndex(null);
  }

  const updateEducation = (index: number, patch: Partial<ResumeEducationEntry>) => {
    const next = [...content.education];
    next[index] = { ...next[index], ...patch };
    update("education", next);
  };

  // Links/languages/volunteering/customSections are all OPTIONAL, so unlike
  // experience/education there's no guaranteed array to spread from —
  // `content.<field> ?? []` is the "nothing added yet" case throughout.
  const updateLink = (index: number, patch: Partial<ResumeLink>) => {
    const next = [...(content.links ?? [])];
    next[index] = { ...next[index], ...patch };
    update("links", next);
  };

  const updateLanguage = (index: number, patch: Partial<ResumeLanguage>) => {
    const next = [...(content.languages ?? [])];
    next[index] = { ...next[index], ...patch };
    update("languages", next);
  };

  const updateVolunteering = (index: number, patch: Partial<ResumeVolunteeringEntry>) => {
    const next = [...(content.volunteering ?? [])];
    next[index] = { ...next[index], ...patch };
    update("volunteering", next);
  };

  const updateCustomSection = (index: number, patch: Partial<ResumeCustomSection>) => {
    const next = [...(content.customSections ?? [])];
    next[index] = { ...next[index], ...patch };
    update("customSections", next);
  };

  return (
    <div className="grid grid-cols-1 gap-8 pb-16 lg:grid-cols-[1fr_460px] lg:items-start print:block print:gap-0 print:pb-0">
    <div className="flex flex-col gap-8 print:hidden">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <EyebrowLabel>Editing</EyebrowLabel>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setSaved(false);
              setDirty(true);
            }}
            className="mt-1 w-full max-w-[420px] border-none bg-transparent font-display text-[26px] outline-none focus:underline"
          />
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={handleSave} disabled={pending}>
            {pending ? "Saving…" : saved ? "Saved" : "Save"}
          </Button>
        </div>
      </div>

      {/* Contact */}
      <section className="flex flex-col gap-3">
        <EyebrowLabel size="sm">Contact</EyebrowLabel>
        <div className="grid grid-cols-2 gap-4">
          <TextField
            id="contact-full-name"
            label="Full name"
            value={content.contact.name ?? ""}
            onChange={(e) => update("contact", { ...content.contact, name: e.target.value })}
            error={flaggedPaths.has("contact.name") ? "Still the example name." : undefined}
          />
          <TextField
            id="contact-location"
            label="Location"
            value={content.contact.location ?? ""}
            onChange={(e) => update("contact", { ...content.contact, location: e.target.value })}
            error={flaggedPaths.has("contact.location") ? "Still the example location." : undefined}
          />
          <TextField
            id="contact-email"
            label="Email"
            value={content.contact.email ?? ""}
            onChange={(e) => update("contact", { ...content.contact, email: e.target.value })}
            error={flaggedPaths.has("contact.email") ? "Still the example email." : undefined}
          />
          <TextField
            id="contact-phone"
            label="Phone"
            value={content.contact.phone ?? ""}
            onChange={(e) => update("contact", { ...content.contact, phone: e.target.value })}
            error={flaggedPaths.has("contact.phone") ? "Still the example phone number." : undefined}
          />
        </div>
      </section>

      {/* Summary */}
      <section className="flex flex-col gap-2">
        <MinimalRichEditor
          key={summaryEditorKey}
          id="summary-field"
          label="Summary"
          defaultValue={content.summary ?? ""}
          onTextChange={(markdown) => update("summary", markdown)}
          minHeightClassName="min-h-[84px]"
          placeholder="A two- to three-sentence summary of your experience."
        />
        {flaggedPaths.has("summary") && <ExampleFlagNotice text="Still the example summary." />}
      </section>

      {/* Experience */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <EyebrowLabel size="sm">Experience</EyebrowLabel>
          <button
            type="button"
            onClick={() =>
              update("experience", [
                ...content.experience,
                { title: "", company: "", location: "", startDate: "", endDate: "", description: "" },
              ])
            }
            className="text-[13px] font-semibold underline underline-offset-2"
          >
            + Add role
          </button>
        </div>
        <div className="flex flex-col gap-4">
          {content.experience.map((entry, i) => (
            <BorderedCard
              key={i}
              id={`experience-${i}-card`}
              draggable
              onDragStart={() => setDragExperienceIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleExperienceDrop(i)}
              onDragEnd={() => setDragExperienceIndex(null)}
              className={`flex flex-col gap-3 p-4 ${dragExperienceIndex === i ? "opacity-40" : ""}`}
            >
              {flaggedPaths.has(`experience.${i}`) && (
                <ExampleFlagNotice text="Still the example content — update or remove this entry." />
              )}
              <div className="flex items-start justify-between">
                <DragHandle />
                <div className="grid flex-1 grid-cols-2 gap-3">
                  <TextField id={`experience-${i}-title`} label="Title" value={entry.title} onChange={(e) => updateExperience(i, { title: e.target.value })} />
                  <TextField id={`experience-${i}-company`} label="Company" value={entry.company} onChange={(e) => updateExperience(i, { company: e.target.value })} />
                  <TextField id={`experience-${i}-start-date`} label="Start date" value={entry.startDate ?? ""} onChange={(e) => updateExperience(i, { startDate: e.target.value })} />
                  <TextField id={`experience-${i}-end-date`} label="End date" value={entry.endDate ?? ""} onChange={(e) => updateExperience(i, { endDate: e.target.value })} />
                </div>
                <RemoveControl onRemove={() => update("experience", content.experience.filter((_, j) => j !== i))} />
              </div>
              <MinimalRichEditorList
                id={`experience-${i}-bullets`}
                label="Achievements"
                paragraphs={experienceBulletParagraphs(entry)}
                bulleted={getExperienceBullets(entry) !== undefined}
                canTurnOffBullets={canTurnOffBullets(experienceBulletParagraphs(entry))}
                onParagraphsChange={(paragraphs, bulleted) => updateExperience(i, bulletsPatch(paragraphs, bulleted))}
                onBulletedChange={(bulleted) =>
                  updateExperience(i, bulletsPatch(experienceBulletParagraphs(entry), bulleted))
                }
                minHeightClassName="min-h-[84px]"
                placeholder="One achievement per paragraph — press Enter to start the next bullet point."
              />
              <RewriteButtons
                onRewrite={(instr) => handleRewrite(i, instr)}
                passCovered={passCovered}
                disabled={rewritingKey !== null || pendingRewrite !== null}
              />
              {rewritingKey === `${i}` && <span className="text-[12px] text-ink-soft">Farah is rewriting…</span>}
              {rewritingKey === null && rewriteErrorKey === `${i}` && rewriteError && (
                <span className="text-[12px] text-rust">{rewriteError}</span>
              )}
              {pendingRewrite?.index === i && (
                <div
                  data-testid="rewrite-preview"
                  className="flex flex-col gap-3 border-[1.5px] border-ink bg-paper p-3"
                >
                  <EyebrowLabel size="sm">Farah&apos;s rewrite — preview</EyebrowLabel>
                  <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">{pendingRewrite.text}</p>
                  <p className="text-[12.5px] italic text-ink-soft">
                    {pendingRewrite.credits > 0
                      ? `${creditsPhrase(pendingRewrite.credits)} already used for this rewrite — Keep or Discard won't charge again, and Discard doesn't refund it.`
                      : "Included with your Pass — Keep or Discard won't use any credits."}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={keepRewrite}
                      className="min-h-11 border-[1.5px] border-ink bg-ink px-4 font-body text-[14px] font-semibold text-paper hover:border-rust hover:bg-rust"
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      onClick={discardRewrite}
                      className="min-h-11 border-[1.5px] border-ink bg-transparent px-4 font-body text-[14px] font-semibold text-ink hover:border-rust hover:text-rust"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              )}
              {/*
                The polite live region: the result and its charge announced together. Always in the DOM (a
                live region inserted together with its text is not reliably announced) and visible, because
                the same sentence is useful to everyone.
              */}
              <p
                role="status"
                aria-live="polite"
                className={announcement?.index === i ? "text-[12px] text-ink-soft" : "sr-only"}
              >
                {announcement?.index === i ? announcement.text : ""}
              </p>
            </BorderedCard>
          ))}
        </div>
      </section>

      {/* Education */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <EyebrowLabel size="sm">Education</EyebrowLabel>
          <button
            type="button"
            onClick={() => update("education", [...content.education, { school: "", degree: "", field: "" }])}
            className="text-[13px] font-semibold underline underline-offset-2"
          >
            + Add education
          </button>
        </div>
        <div className="flex flex-col gap-3">
          {content.education.map((entry, i) => (
            <div
              key={i}
              id={`education-${i}-card`}
              className={`flex flex-col gap-2 ${dragEducationIndex === i ? "opacity-40" : ""}`}
            >
              {flaggedPaths.has(`education.${i}`) && (
                <ExampleFlagNotice text="Still the example content — update or remove this entry." />
              )}
              <div
                draggable
                onDragStart={() => setDragEducationIndex(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleEducationDrop(i)}
                onDragEnd={() => setDragEducationIndex(null)}
                className="flex items-start gap-3"
              >
                <DragHandle />
                <div className="grid flex-1 grid-cols-2 gap-3">
                  <TextField id={`education-${i}-school`} label="School" value={entry.school} onChange={(e) => updateEducation(i, { school: e.target.value })} />
                  <TextField id={`education-${i}-degree`} label="Degree" value={entry.degree ?? ""} onChange={(e) => updateEducation(i, { degree: e.target.value })} />
                </div>
                <RemoveControl onRemove={() => update("education", content.education.filter((_, j) => j !== i))} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Skills */}
      <section className="flex flex-col gap-2">
        <EyebrowLabel size="sm">Skills</EyebrowLabel>
        <input
          id="skills-field"
          value={content.skills.join(", ")}
          onChange={(e) => update("skills", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
          className={`min-h-11 border-[1.5px] ${flaggedPaths.has("skills") ? "border-rust" : "border-ink"} bg-card px-3.5 py-2.5 font-body text-[14.5px] outline-none focus:border-rust`}
          placeholder="Comma-separated, e.g. product management, sql, figma"
        />
        {flaggedPaths.has("skills") && <ExampleFlagNotice text="Still the example skills list." />}
      </section>

      {/* Projects */}
      <section className="flex flex-col gap-2">
        <EyebrowLabel size="sm">Projects</EyebrowLabel>
        <TextArea
          id="projects-field"
          label="Projects"
          hideLabel
          value={content.projects.join("\n")}
          onChange={(e) => update("projects", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
          className={flaggedPaths.has("projects") ? "border-rust" : undefined}
          placeholder="One project per line"
        />
        {flaggedPaths.has("projects") && <ExampleFlagNotice text="Still the example projects list." />}
      </section>

      {/* Certifications */}
      <section className="flex flex-col gap-2">
        <EyebrowLabel size="sm">Certifications</EyebrowLabel>
        <TextArea
          id="certifications-field"
          label="Certifications"
          hideLabel
          value={content.certifications.join("\n")}
          onChange={(e) => update("certifications", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
          className={flaggedPaths.has("certifications") ? "border-rust" : undefined}
          placeholder="One certification per line"
        />
        {flaggedPaths.has("certifications") && <ExampleFlagNotice text="Still the example certifications list." />}
      </section>

      {/*
        More sections — links, languages, awards, publications, volunteering,
        custom sections, references-on-request. COLLAPSED BY DEFAULT (no
        `open` attribute): none of these existed before this field set did,
        and a user who wants none of them should see a form no longer than
        it was before — the reason this uses <details> rather than a section
        that's simply always rendered. Nothing here is required, and every
        field stays absent (not an empty placeholder) until actually filled
        in, matching the "absent means unused" convention the rest of this
        schema follows.
      */}
      <details className="group border-t border-line pt-5">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-[13.5px] font-semibold text-ink-soft marker:content-none [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
            ›
          </span>
          More sections
          <span className="font-normal text-ink-soft/70">
            — links, languages, awards, publications, volunteering, custom
          </span>
        </summary>

        <div className="mt-5 flex flex-col gap-8">
          {/* Links */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <EyebrowLabel size="sm">Links</EyebrowLabel>
              <button
                type="button"
                onClick={() => update("links", [...(content.links ?? []), { label: "", url: "" }])}
                className="text-[13px] font-semibold underline underline-offset-2"
              >
                + Add link
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {(content.links ?? []).map((link, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="grid flex-1 grid-cols-2 gap-3">
                    <TextField
                      id={`links-${i}-label`}
                      label="Label"
                      value={link.label}
                      onChange={(e) => updateLink(i, { label: e.target.value })}
                      placeholder="Portfolio"
                    />
                    <TextField
                      id={`links-${i}-url`}
                      label="URL"
                      value={link.url}
                      onChange={(e) => updateLink(i, { url: e.target.value })}
                      placeholder="https://…"
                    />
                  </div>
                  <RemoveControl
                    onRemove={() => update("links", (content.links ?? []).filter((_, j) => j !== i))}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Languages */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <EyebrowLabel size="sm">Languages</EyebrowLabel>
              <button
                type="button"
                onClick={() => update("languages", [...(content.languages ?? []), { name: "", level: "" }])}
                className="text-[13px] font-semibold underline underline-offset-2"
              >
                + Add language
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {(content.languages ?? []).map((lang, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="grid flex-1 grid-cols-2 gap-3">
                    <TextField
                      id={`languages-${i}-name`}
                      label="Language"
                      value={lang.name}
                      onChange={(e) => updateLanguage(i, { name: e.target.value })}
                    />
                    <TextField
                      id={`languages-${i}-level`}
                      label="Level"
                      value={lang.level ?? ""}
                      onChange={(e) => updateLanguage(i, { level: e.target.value })}
                      placeholder="Fluent"
                    />
                  </div>
                  <RemoveControl
                    onRemove={() =>
                      update("languages", (content.languages ?? []).filter((_, j) => j !== i))
                    }
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Awards */}
          <section className="flex flex-col gap-2">
            <EyebrowLabel size="sm">Awards</EyebrowLabel>
            <TextArea
              id="awards-field"
              label="Awards"
              hideLabel
              value={(content.awards ?? []).join("\n")}
              onChange={(e) =>
                update("awards", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))
              }
              placeholder="One award per line"
            />
          </section>

          {/* Publications */}
          <section className="flex flex-col gap-2">
            <EyebrowLabel size="sm">Publications</EyebrowLabel>
            <TextArea
              id="publications-field"
              label="Publications"
              hideLabel
              value={(content.publications ?? []).join("\n")}
              onChange={(e) =>
                update("publications", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))
              }
              placeholder="One publication per line"
            />
          </section>

          {/* Volunteering */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <EyebrowLabel size="sm">Volunteering</EyebrowLabel>
              <button
                type="button"
                onClick={() =>
                  update("volunteering", [
                    ...(content.volunteering ?? []),
                    { role: "", organisation: "", startDate: "", endDate: "", description: "" },
                  ])
                }
                className="text-[13px] font-semibold underline underline-offset-2"
              >
                + Add volunteering
              </button>
            </div>
            <div className="flex flex-col gap-4">
              {(content.volunteering ?? []).map((entry, i) => (
                <BorderedCard key={i} className="flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between">
                    <div className="grid flex-1 grid-cols-2 gap-3">
                      <TextField
                        id={`volunteering-${i}-role`}
                        label="Role"
                        value={entry.role}
                        onChange={(e) => updateVolunteering(i, { role: e.target.value })}
                      />
                      <TextField
                        id={`volunteering-${i}-organisation`}
                        label="Organisation"
                        value={entry.organisation}
                        onChange={(e) => updateVolunteering(i, { organisation: e.target.value })}
                      />
                      <TextField
                        id={`volunteering-${i}-start-date`}
                        label="Start date"
                        value={entry.startDate ?? ""}
                        onChange={(e) => updateVolunteering(i, { startDate: e.target.value })}
                      />
                      <TextField
                        id={`volunteering-${i}-end-date`}
                        label="End date"
                        value={entry.endDate ?? ""}
                        onChange={(e) => updateVolunteering(i, { endDate: e.target.value })}
                      />
                    </div>
                    <RemoveControl
                      onRemove={() =>
                        update("volunteering", (content.volunteering ?? []).filter((_, j) => j !== i))
                      }
                    />
                  </div>
                  <TextArea
                    label="What you did"
                    hideLabel
                    value={entry.description ?? ""}
                    onChange={(e) => updateVolunteering(i, { description: e.target.value })}
                    placeholder="What you did"
                  />
                </BorderedCard>
              ))}
            </div>
          </section>

          {/* Custom sections */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <EyebrowLabel size="sm">Custom sections</EyebrowLabel>
              <button
                type="button"
                onClick={() =>
                  update("customSections", [...(content.customSections ?? []), { title: "", items: [] }])
                }
                className="text-[13px] font-semibold underline underline-offset-2"
              >
                + Add section
              </button>
            </div>
            <div className="flex flex-col gap-4">
              {(content.customSections ?? []).map((section, i) => (
                <BorderedCard key={i} className="flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <TextField
                      id={`custom-section-${i}-title`}
                      label="Section title"
                      value={section.title}
                      onChange={(e) => updateCustomSection(i, { title: e.target.value })}
                      placeholder="Tech Stack"
                    />
                    <RemoveControl
                      onRemove={() =>
                        update("customSections", (content.customSections ?? []).filter((_, j) => j !== i))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <TextArea
                      id={`custom-section-${i}-items`}
                      label="Items (one per line)"
                      value={section.items.join("\n")}
                      onChange={(e) =>
                        updateCustomSection(i, {
                          items: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                        })
                      }
                    />
                  </div>
                </BorderedCard>
              ))}
            </div>
          </section>

          {/* References */}
          <section className="flex flex-col gap-2">
            <EyebrowLabel size="sm">References</EyebrowLabel>
            <label htmlFor="references-on-request" className="flex items-center gap-2 text-[13.5px] text-ink-soft">
              <input
                id="references-on-request"
                type="checkbox"
                checked={content.referencesOnRequest ?? false}
                onChange={(e) => update("referencesOnRequest", e.target.checked)}
                className="h-4 w-4 accent-ink"
              />
              Show &ldquo;References available on request&rdquo; instead of listing them
            </label>
          </section>
        </div>
      </details>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={pending}>
          {pending ? "Saving…" : saved ? "Saved" : "Save"}
        </Button>
        <button
          type="button"
          onClick={() => router.push("/resume-builder")}
          className="text-[13.5px] font-semibold text-ink-soft underline underline-offset-2"
        >
          Back to Resume Builder
        </button>
      </div>
    </div>

    {/*
      LIVE PREVIEW, replacing the old separate /resume-builder/preview page
      (Stage 3.1) — reuses TemplateRenderer exactly as that page and the
      template thumbnails do, fed the SAME `content` state the form above is
      editing, so it updates on every keystroke with no extra plumbing.
      `sticky` keeps it in view while the (longer) form scrolls, on screen
      only — print:static because print has no scroll position to stick to,
      and this is also the only part of the page NOT print:hidden, so it is
      the whole of what a PDF export contains.
    */}
    <div className="sticky top-6 flex flex-col gap-3 print:static print:top-auto">
      <div className="flex items-center justify-between print:hidden">
        <EyebrowLabel size="sm">Live preview</EyebrowLabel>
        <PrintButton
          resumeId={resumeId}
          content={content}
          onClearExample={(next) => {
            setContent(next);
            setSaved(false);
            setSummaryEditorKey((k) => k + 1);
          }}
        />
      </div>
      <ResumePrintSurface>
        <TemplateRenderer slug={templateSlug} resume={content} />
      </ResumePrintSurface>
    </div>
  </div>
  );
}
