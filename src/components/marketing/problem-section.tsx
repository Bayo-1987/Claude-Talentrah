import { EyebrowLabel } from "@/components/ui";

const PROBLEMS = [
  {
    number: "01",
    copy: "Rewriting your resume for every application takes hours you don't have.",
  },
  {
    number: "02",
    copy: "Generic AI advice reads the same for every job seeker, in every market.",
  },
  {
    number: "03",
    copy: "Tracking applications across spreadsheets and job boards falls apart fast.",
  },
];

export function ProblemSection() {
  return (
    <div id="problem" className="border-y border-line bg-paper-alt py-22">
      <div className="mx-auto max-w-[1120px] px-10">
        <div className="mb-14 flex max-w-[640px] flex-col gap-4">
          <EyebrowLabel>The problem</EyebrowLabel>
          <h2 className="text-[32px] leading-[1.25]">
            Job searching shouldn&apos;t mean rewriting your resume from scratch, for every single
            role.
          </h2>
          <p className="text-[16px] text-ink-soft">
            Tailoring for each application is repetitive and easy to get wrong. Tracking where
            you&apos;ve applied gets messy fast. And most &ldquo;AI career advice&rdquo; reads the
            same for every job seeker — which means it doesn&apos;t really apply to you.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-10 min-[901px]:grid-cols-3">
          {PROBLEMS.map((problem) => (
            <div
              key={problem.number}
              className="flex flex-col gap-2 border-t-[2.5px] border-ink pt-4.5"
            >
              <span className="font-display text-[22px] italic text-rust">{problem.number}</span>
              <p className="text-[15px] text-ink-soft">{problem.copy}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
