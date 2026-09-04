"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, TextField, EyebrowLabel, BorderedCard } from "@/components/ui";
import { saveResumeAction, rewriteBulletAction } from "@/lib/resume-builder/actions";
import { TemplateRenderer } from "@/components/resume-builder/templates";
import { PrintButton } from "@/components/resume-builder/print-button";
import type {
  StructuredResume,
  ResumeExperienceEntry,
  ResumeEducationEntry,
} from "@/lib/resume/types";

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

function RewriteButtons({
  onRewrite,
}: {
  onRewrite: (instruction: "impact" | "quantify" | "concise") => void;
}) {
  return (
    <div className="flex items-center gap-3 text-[12px]">
      <span className="font-semibold text-ink-soft">Farah:</span>
      <button type="button" onClick={() => onRewrite("impact")} className="underline underline-offset-2 text-ink-soft hover:text-rust">
        More impact-driven
      </button>
      <button type="button" onClick={() => onRewrite("quantify")} className="underline underline-offset-2 text-ink-soft hover:text-rust">
        Quantify this
      </button>
      <button type="button" onClick={() => onRewrite("concise")} className="underline underline-offset-2 text-ink-soft hover:text-rust">
        More concise
      </button>
    </div>
  );
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
}

export function ResumeEditor({ resumeId, initialTitle, initialContent, templateSlug }: ResumeEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState<StructuredResume>(initialContent);
  const [rewritingKey, setRewritingKey] = useState<string | null>(null);
  const [rewriteError, setRewriteError] = useState<string | null>(null);
  const [rewriteErrorKey, setRewriteErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [dragExperienceIndex, setDragExperienceIndex] = useState<number | null>(null);
  const [dragEducationIndex, setDragEducationIndex] = useState<number | null>(null);
  const router = useRouter();

  function update<K extends keyof StructuredResume>(key: K, value: StructuredResume[K]) {
    setContent((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleRewrite(index: number, instruction: "impact" | "quantify" | "concise") {
    const key = `${index}`;
    setRewritingKey(key);
    setRewriteError(null);
    setRewriteErrorKey(null);
    try {
      const { text, error } = await rewriteBulletAction(
        content.experience[index].description ?? "",
        instruction,
      );
      if (error) {
        setRewriteError(error);
        setRewriteErrorKey(key);
        return;
      }
      const next = [...content.experience];
      next[index] = { ...next[index], description: text };
      update("experience", next);
    } finally {
      setRewritingKey(null);
    }
  }

  function handleSave() {
    startTransition(async () => {
      await saveResumeAction(resumeId, content, title);
      setSaved(true);
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
          />
          <TextField
            id="contact-location"
            label="Location"
            value={content.contact.location ?? ""}
            onChange={(e) => update("contact", { ...content.contact, location: e.target.value })}
          />
          <TextField
            id="contact-email"
            label="Email"
            value={content.contact.email ?? ""}
            onChange={(e) => update("contact", { ...content.contact, email: e.target.value })}
          />
          <TextField
            id="contact-phone"
            label="Phone"
            value={content.contact.phone ?? ""}
            onChange={(e) => update("contact", { ...content.contact, phone: e.target.value })}
          />
        </div>
      </section>

      {/* Summary */}
      <section className="flex flex-col gap-2">
        <EyebrowLabel size="sm">Summary</EyebrowLabel>
        <textarea
          value={content.summary ?? ""}
          onChange={(e) => update("summary", e.target.value)}
          rows={3}
          className="border-[1.5px] border-ink bg-card p-3 font-body text-[14.5px] outline-none focus:border-rust"
          placeholder="A two- to three-sentence summary of your experience."
        />
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
              draggable
              onDragStart={() => setDragExperienceIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleExperienceDrop(i)}
              onDragEnd={() => setDragExperienceIndex(null)}
              className={`flex flex-col gap-3 p-4 ${dragExperienceIndex === i ? "opacity-40" : ""}`}
            >
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
              <textarea
                value={entry.description ?? ""}
                onChange={(e) => updateExperience(i, { description: e.target.value })}
                rows={2}
                className="border-[1.5px] border-ink bg-card p-3 font-body text-[14px] outline-none focus:border-rust"
              />
              <RewriteButtons onRewrite={(instr) => handleRewrite(i, instr)} />
              {rewritingKey === `${i}` && <span className="text-[12px] text-ink-soft">Farah is rewriting…</span>}
              {rewritingKey === null && rewriteErrorKey === `${i}` && rewriteError && (
                <span className="text-[12px] text-rust">{rewriteError}</span>
              )}
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
              draggable
              onDragStart={() => setDragEducationIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleEducationDrop(i)}
              onDragEnd={() => setDragEducationIndex(null)}
              className={`flex items-start gap-3 ${dragEducationIndex === i ? "opacity-40" : ""}`}
            >
              <DragHandle />
              <div className="grid flex-1 grid-cols-2 gap-3">
                <TextField id={`education-${i}-school`} label="School" value={entry.school} onChange={(e) => updateEducation(i, { school: e.target.value })} />
                <TextField id={`education-${i}-degree`} label="Degree" value={entry.degree ?? ""} onChange={(e) => updateEducation(i, { degree: e.target.value })} />
              </div>
              <RemoveControl onRemove={() => update("education", content.education.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
      </section>

      {/* Skills */}
      <section className="flex flex-col gap-2">
        <EyebrowLabel size="sm">Skills</EyebrowLabel>
        <input
          value={content.skills.join(", ")}
          onChange={(e) => update("skills", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
          className="min-h-11 border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[14.5px] outline-none focus:border-rust"
          placeholder="Comma-separated, e.g. product management, sql, figma"
        />
      </section>

      {/* Projects */}
      <section className="flex flex-col gap-2">
        <EyebrowLabel size="sm">Projects</EyebrowLabel>
        <textarea
          value={content.projects.join("\n")}
          onChange={(e) => update("projects", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
          rows={2}
          className="border-[1.5px] border-ink bg-card p-3 font-body text-[14.5px] outline-none focus:border-rust"
          placeholder="One project per line"
        />
      </section>

      {/* Certifications */}
      <section className="flex flex-col gap-2">
        <EyebrowLabel size="sm">Certifications</EyebrowLabel>
        <textarea
          value={content.certifications.join("\n")}
          onChange={(e) => update("certifications", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
          rows={2}
          className="border-[1.5px] border-ink bg-card p-3 font-body text-[14.5px] outline-none focus:border-rust"
          placeholder="One certification per line"
        />
      </section>

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
        <PrintButton resumeId={resumeId} content={content} />
      </div>
      <div className="border-[1.5px] border-ink print:border-none">
        <TemplateRenderer slug={templateSlug} resume={content} />
      </div>
    </div>
  </div>
  );
}
