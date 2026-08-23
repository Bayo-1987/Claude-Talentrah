import { EyebrowLabel } from "@/components/ui";
import { JdDemoInput } from "./jd-demo-input";
import { JdDemoExample } from "./jd-demo-example";

export function HeroSection() {
  return (
    <div id="top" className="py-[72px] pb-[84px]">
      <div className="mx-auto flex max-w-[1120px] flex-col items-center gap-7.5 px-10">
        <div className="flex max-w-[680px] flex-col items-center gap-2 text-center">
          <EyebrowLabel className="mb-1.5">AI-Powered Job Matching</EyebrowLabel>
          <h1 className="text-[50px] leading-[1.12] tracking-[-0.01em]">
            Talk to Farah. See exactly how well you match a job.
          </h1>
          <p className="mt-2.5 max-w-[540px] text-[17px] text-ink-soft">
            Paste a job link or description and Farah returns your match score, what&apos;s
            missing, and a tailored resume — free, no account needed.
          </p>
        </div>

        <JdDemoInput />
        <JdDemoExample />
      </div>
    </div>
  );
}
