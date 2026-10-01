import { ResumeEditor } from "@/components/resume-builder/resume-editor";
import type { StructuredResume } from "@/lib/resume/types";

/**
 * QA-only, same convention as `/dev/template-skeletons/[configKey]`: reached by
 * URL, outside the `(app)` group (no masthead, no auth), and no database. It
 * mounts the real `ResumeEditor` on a small fixed resume so
 * `e2e/resume-editor-bullets.spec.ts` can drive the Achievements field's
 * bulleted-list control in a browser. Nothing is saved from here: the Save
 * button would call a Server Action that needs a signed-in user, and the spec
 * never presses it.
 */
const FIXTURE: StructuredResume = {
  contact: { name: "Ada Obi", email: "ada.obi@example.com" },
  summary: "",
  experience: [
    {
      title: "Head of Operations",
      company: "Northbridge Systems",
      startDate: "Sep 2022",
      endDate: "Present",
      description: "ZQONE Led the migration of the settlement ledger.",
    },
  ],
  education: [],
  skills: [],
  projects: [],
  certifications: [],
};

export default function ResumeEditorFixturePage() {
  return (
    <div className="bg-paper px-6 py-8">
      <ResumeEditor resumeId="fixture" initialTitle="Fixture resume" initialContent={FIXTURE} templateSlug={null} />
    </div>
  );
}
