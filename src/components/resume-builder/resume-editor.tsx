"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, TextField, EyebrowLabel, BorderedCard } from "@/components/ui";
import { saveResumeAction, rewriteBulletAction } from "@/lib/resume-builder/actions";
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

function ReorderControls({
  onUp,
  onDown,
  onRemove,
}: {
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={onUp} aria-label="Move up" className="flex h-9 w-9 items-center justify-center text-ink-soft hover:text-rust">
        ↑
      </button>
      <button type="button" onClick={onDown} aria-label="Move down" className="flex h-9 w-9 items-center justify-center text-ink-soft hover:text-rust">
        ↓
      </button>
      <button type="button" onClick={onRemove} aria-label="Remove" className="flex h-9 w-9 items-center justify-center text-ink-soft hover:text-rust">
        ×
      </button>
    </div>
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
}

export function ResumeEditor({ resumeId, initialTitle, initialContent }: ResumeEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState<StructuredResume>(initialContent);
  const [rewritingKey, setRewritingKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function update<K extends keyof StructuredResume>(key: K, value: StructuredResume[K]) {
    setContent((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleRewrite(index: number, instruction: "impact" | "quantify" | "concise") {
    const key = `${index}`;
    setRewritingKey(key);
    try {
      const rewritten = await rewriteBulletAction(content.experience[index].description ?? "", instruction);
      const next = [...content.experience];
      next[index] = { ...next[index], description: rewritten };
      update("experience", next);
    } catch {
      // ANTHROPIC_API_KEY likely isn't configured yet — leave the text as-is.
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

  const updateEducation = (index: number, patch: Partial<ResumeEducationEntry>) => {
    const next = [...content.education];
    next[index] = { ...next[index], ...patch };
    update("education", next);
  };

  return (
    <div className="flex flex-col gap-8 pb-16">
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
          <Link
            href={`/resume-builder/preview?resumeId=${resumeId}`}
            className="text-[13.5px] font-semibold underline underline-offset-2"
          >
            Preview →
          </Link>
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
            label="Full name"
            value={content.contact.name ?? ""}
            onChange={(e) => update("contact", { ...content.contact, name: e.target.value })}
          />
          <TextField
            label="Location"
            value={content.contact.location ?? ""}
            onChange={(e) => update("contact", { ...content.contact, location: e.target.value })}
          />
          <TextField
            label="Email"
            value={content.contact.email ?? ""}
            onChange={(e) => update("contact", { ...content.contact, email: e.target.value })}
          />
          <TextField
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
            <BorderedCard key={i} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between">
                <div className="grid flex-1 grid-cols-2 gap-3">
                  <TextField label="Title" value={entry.title} onChange={(e) => updateExperience(i, { title: e.target.value })} />
                  <TextField label="Company" value={entry.company} onChange={(e) => updateExperience(i, { company: e.target.value })} />
                  <TextField label="Start date" value={entry.startDate ?? ""} onChange={(e) => updateExperience(i, { startDate: e.target.value })} />
                  <TextField label="End date" value={entry.endDate ?? ""} onChange={(e) => updateExperience(i, { endDate: e.target.value })} />
                </div>
                <ReorderControls
                  onUp={() => update("experience", moveItem(content.experience, i, i - 1))}
                  onDown={() => update("experience", moveItem(content.experience, i, i + 1))}
                  onRemove={() => update("experience", content.experience.filter((_, j) => j !== i))}
                />
              </div>
              <textarea
                value={entry.description ?? ""}
                onChange={(e) => updateExperience(i, { description: e.target.value })}
                rows={2}
                className="border-[1.5px] border-ink bg-card p-3 font-body text-[14px] outline-none focus:border-rust"
              />
              <RewriteButtons onRewrite={(instr) => handleRewrite(i, instr)} />
              {rewritingKey === `${i}` && <span className="text-[12px] text-ink-soft">Farah is rewriting…</span>}
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
            <div key={i} className="flex items-start gap-3">
              <div className="grid flex-1 grid-cols-2 gap-3">
                <TextField label="School" value={entry.school} onChange={(e) => updateEducation(i, { school: e.target.value })} />
                <TextField label="Degree" value={entry.degree ?? ""} onChange={(e) => updateEducation(i, { degree: e.target.value })} />
              </div>
              <ReorderControls
                onUp={() => update("education", moveItem(content.education, i, i - 1))}
                onDown={() => update("education", moveItem(content.education, i, i + 1))}
                onRemove={() => update("education", content.education.filter((_, j) => j !== i))}
              />
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
  );
}
