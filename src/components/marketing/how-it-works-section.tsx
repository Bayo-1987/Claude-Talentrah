import { EyebrowLabel } from "@/components/ui";

const STEPS = [
  {
    number: "01",
    title: "Paste a job link or description",
    copy: "Talentrah reads the real requirements — not just keywords.",
  },
  {
    number: "02",
    title: "Farah analyzes the gap",
    copy: "See exactly what's matched and what's missing from your resume.",
  },
  {
    number: "03",
    title: "Get a tailored resume + match score",
    copy: "Editable, exportable, ready to send.",
  },
  {
    number: "04",
    title: "Apply with confidence",
    copy: "Manually, or let Farah apply on your behalf with your review.",
  },
];

export function HowItWorksSection() {
  return (
    <div id="how-it-works" className="py-24">
      <div className="mx-auto max-w-[1120px] px-10">
        <div className="mb-14 flex max-w-[560px] flex-col gap-4">
          <EyebrowLabel>How it works</EyebrowLabel>
          <h2 className="text-[32px] leading-[1.25]">
            From job posting to tailored application, in four steps.
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-8 min-[901px]:grid-cols-4">
          {STEPS.map((step) => (
            <div key={step.number} className="flex flex-col gap-3 border-t border-line pt-4">
              <span className="font-display text-[28px] italic text-line">{step.number}</span>
              <h3 className="font-display text-[17px] font-semibold text-ink">{step.title}</h3>
              <p className="text-[14.5px] text-ink-soft">{step.copy}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
