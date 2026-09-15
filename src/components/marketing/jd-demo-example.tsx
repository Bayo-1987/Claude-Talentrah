import { EyebrowLabel, MatchTierBadge } from "@/components/ui";

/**
 * Static worked example of a Farah result — matches Main-Editorial.dc.html's
 * "this is a live example" panel, which is itself a fixed illustrative
 * sample, not computed from the input box above it.
 */
export function JdDemoExample() {
  return (
    <div className="mt-3 w-full max-w-[860px] border-[1.5px] border-ink bg-card">
      <div className="flex items-center gap-2.5 border-b border-line px-6 py-3.5">
        <EyebrowLabel>What Farah sends back — this is a live example</EyebrowLabel>
      </div>
      <div className="flex flex-col gap-6 p-7.5 min-[901px]:flex-row">
        <div className="flex flex-1 flex-col gap-4.5 min-[901px]:pr-7.5">
          <div>
            <EyebrowLabel className="mb-2.5 block">
              Your match — Senior Product Manager, Fintech
            </EyebrowLabel>
            <MatchTierBadge score={87} variant="display" />
          </div>

          <div className="flex flex-col gap-3 border-t border-dashed border-line pt-3.5">
            <div className="flex items-start gap-2.5">
              <span className="flex-shrink-0 font-display italic text-green">✓</span>
              <span className="text-[13.5px] text-ink-soft">
                Agile product delivery — strong match
              </span>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="flex-shrink-0 font-display italic text-amber">△</span>
              <span className="text-[13.5px] text-ink-soft">
                &ldquo;Stakeholder management&rdquo; — appears 3x in this JD, 0x in your resume
              </span>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="flex-shrink-0 font-display italic text-amber">△</span>
              <span className="text-[13.5px] text-ink-soft">
                Fintech domain experience — consider a specific example
              </span>
            </div>
          </div>
        </div>

        <div className="w-px flex-shrink-0 bg-line" />

        <div className="flex flex-1 flex-col justify-center gap-3.5 min-[901px]:pl-7.5">
          <div className="border border-line bg-paper p-4">
            <EyebrowLabel className="mb-2 block">Tailored resume preview</EyebrowLabel>
            <p className="text-[13.5px] leading-relaxed text-ink-soft">
              Led cross-functional squads across product, design, and engineering to ship three
              consumer fintech features in emerging markets,{" "}
              <span className="bg-rust-soft px-1 font-semibold text-rust-hover">
                driving stakeholder alignment
              </span>{" "}
              across compliance, ops, and executive leadership.
            </p>
          </div>
          <div className="font-display text-[12.5px] italic text-ink-soft">
            Preview only — create a free account to export, save, and apply.
          </div>
        </div>
      </div>
    </div>
  );
}
