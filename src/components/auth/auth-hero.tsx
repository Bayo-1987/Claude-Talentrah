import Link from "next/link";
import { EyebrowLabel, BorderedCard } from "@/components/ui";

export function AuthHero() {
  return (
    <div className="flex h-full flex-col justify-between bg-ink p-10 text-paper md:p-14">
      <Link href="/" className="flex items-center gap-2.5 no-underline">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG, next/image's optimizer needs SVG allow-listing for no real benefit here */}
        <img
          src="/talentrah-mark-reversed.svg"
          alt=""
          width={100}
          height={100}
          className="h-7 w-7 flex-shrink-0"
        />
        <span className="font-display text-[24px] font-medium tracking-tight text-paper">
          Talentrah
        </span>
      </Link>

      <div className="flex flex-col gap-6">
        <h1 className="font-display text-[34px] leading-tight text-paper">
          Talk to Farah. See exactly how well you match a job.
        </h1>
        <p className="max-w-[420px] text-[15px] text-[oklch(80%_0.015_60)]">
          Paste a job description and Farah scores the match, shows
          what&apos;s missing, and drafts a tailored resume.
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
        <EyebrowLabel size="sm">How Farah works</EyebrowLabel>
        <p
          className="mt-3 font-display text-[16px] italic leading-relaxed"
          style={{ color: "var(--paper)" }}
        >
          She reads the job description, compares it with your resume, and
          rewrites your resume&apos;s wording to fit the role &mdash; using only
          the experience you already have.
        </p>
      </BorderedCard>
    </div>
  );
}
