import Link from "next/link";
import { EyebrowLabel, BorderedCard } from "@/components/ui";

/**
 * Fictional persona, per build-prompt open decision #2 — the reference
 * design used a real public figure's name here, which would imply a false
 * endorsement. Invented from scratch, not adapted from anyone real.
 */
const TESTIMONIAL = {
  quote:
    "Farah showed me exactly why my resume wasn't landing interviews — then fixed it in one sitting. I had three interviews booked within two weeks.",
  name: "Amaka O.",
  role: "Product Manager, Lagos",
};

export function AuthHero() {
  return (
    <div className="flex h-full flex-col justify-between bg-ink p-10 text-paper md:p-14">
      <Link
        href="/"
        className="font-display text-[24px] font-medium tracking-tight text-paper no-underline"
      >
        Talentrah
      </Link>

      <div className="flex flex-col gap-6">
        <h1 className="font-display text-[34px] leading-tight text-paper">
          Talk to Farah. See exactly how well you match a job.
        </h1>
        <p className="max-w-[420px] text-[15px] text-[oklch(80%_0.015_60)]">
          Paste a job link or description and get your match score, what&apos;s
          missing, and a tailored resume — free, no account needed to preview.
        </p>
      </div>

      <BorderedCard
        borderWidth="1.5"
        className="max-w-[420px] p-5"
        style={{
          borderColor: "oklch(40% 0.02 50)",
          backgroundColor: "oklch(24% 0.018 50)",
        }}
      >
        <EyebrowLabel size="sm">What job seekers say</EyebrowLabel>
        <p
          className="mt-3 font-display text-[16px] italic leading-relaxed"
          style={{ color: "var(--paper)" }}
        >
          &ldquo;{TESTIMONIAL.quote}&rdquo;
        </p>
        <p className="mt-3 text-[13px]" style={{ color: "oklch(75% 0.015 60)" }}>
          {TESTIMONIAL.name} — {TESTIMONIAL.role}
        </p>
      </BorderedCard>
    </div>
  );
}
