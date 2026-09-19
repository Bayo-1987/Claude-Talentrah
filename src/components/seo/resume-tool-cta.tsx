import Link from "next/link";
import { getOptionalUser } from "@/lib/auth/require-user";
import { buttonClasses } from "@/components/ui";

/**
 * send-386 — the conversion CTA shared by /ai-resume-tailoring and
 * /ats-resume-checker, both landing on the same real feature (/tailor).
 *
 * Auth-aware for the same reason /jobs/remote's own CTA is (see that page's
 * "OPTIONAL user... a returning signed-in visitor should not be pitched the
 * account they already have"): a signed-in visitor who found this page via
 * search gets a direct link to the feature, not another "create a free
 * account" pitch for an account they already hold.
 *
 * COPY IS PINNED TO CLAUDE.md §6.9 EXACTLY: "First tailoring run + first
 * cover letter are one-time free trial; everything after draws from
 * Credits." This says "first run", never "resume tailoring is free" — the
 * one line every reviewer of this page should re-check against that section
 * before changing.
 */
export async function ResumeToolCta({ targetPath }: { targetPath: "/tailor" }) {
  const session = await getOptionalUser();

  if (session) {
    return (
      <Link href={targetPath} className={buttonClasses("primary", "md", "no-underline")}>
        Paste a job description
      </Link>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Link
        href={`/signup?redirectTo=${encodeURIComponent(targetPath)}`}
        className={buttonClasses("primary", "md", "no-underline")}
      >
        Create a free account to try it
      </Link>
      <p className="text-[12.5px] text-ink-soft">
        Your first tailoring run and first cover letter are free — nothing
        beyond that until you choose to use Talentrah Credits.
      </p>
    </div>
  );
}
