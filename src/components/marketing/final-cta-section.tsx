import Link from "next/link";
import { buttonClasses } from "@/components/ui";

export function FinalCtaSection() {
  return (
    <div className="py-24 text-center">
      <div className="mx-auto flex max-w-[1120px] flex-col items-center gap-5.5 px-10">
        <h2 className="max-w-[620px] text-[36px]">Try it with your next job application.</h2>
        <p className="max-w-[480px] text-[16px] text-ink-soft">
          Paste a job description above, or create a free account to save your tailored resumes
          and start tracking applications.
        </p>
        <Link
          href="/signup"
          className={buttonClasses("primary", "md", "px-9 py-4.5 text-[16px] no-underline")}
        >
          Get started for free
        </Link>
      </div>
    </div>
  );
}
