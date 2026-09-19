import Link from "next/link";
import { getOptionalUser } from "@/lib/auth/require-user";
import { buttonClasses } from "@/components/ui";

/**
 * The conversion CTA for /ai-interview-prep. Farah's "Job Interview Prep"
 * quick action (src/lib/farah/quick-actions.ts) is chat-only — `href: null`,
 * a starter prompt into whichever page docks the panel — there is no
 * dedicated interview-prep route to link straight into. /jobs is where the
 * panel is docked for every signed-in seeker, so that's the honest target:
 * this CTA gets someone to an account and to the panel, not to a
 * standalone tool that doesn't exist.
 */
export async function FarahInterviewPrepCta() {
  const session = await getOptionalUser();

  if (session) {
    return (
      <Link href="/jobs" className={buttonClasses("primary", "md", "no-underline")}>
        Ask Farah for interview prep
      </Link>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Link href="/signup?redirectTo=%2Fjobs" className={buttonClasses("primary", "md", "no-underline")}>
        Create a free account to ask Farah
      </Link>
      <p className="text-[12.5px] text-ink-soft">
        Every account gets a free monthly allowance of messages with Farah
        before it draws from Talentrah Credits.
      </p>
    </div>
  );
}
