import Link from "next/link";
import { getOptionalUser } from "@/lib/auth/require-user";
import { buttonClasses } from "@/components/ui";

/**
 * The conversion CTA for /ai-resume-builder, mirroring resume-tool-cta.tsx's
 * auth-aware shape (a returning signed-in visitor gets a direct link to the
 * feature, not another account pitch) — but NOT that component itself,
 * because its copy is pinned to the tailoring/cover-letter free-trial
 * mechanic (build-prompt §6.3: first run of each is free) and would be
 * simply wrong here. Resume Builder's free tier is a different shape
 * entirely (§6.4: "Free tier = limited templates; more via credits/pass") —
 * there is no "first free run" for building a resume the way there is for
 * a tailoring run, so this needed its own copy, not a shared prop toggle.
 */
export async function ResumeBuilderCta() {
  const session = await getOptionalUser();

  if (session) {
    return (
      <Link href="/resume-builder" className={buttonClasses("primary", "md", "no-underline")}>
        Start building
      </Link>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Link
        href="/signup?redirectTo=%2Fresume-builder"
        className={buttonClasses("primary", "md", "no-underline")}
      >
        Create a free account to start building
      </Link>
      <p className="text-[12.5px] text-ink-soft">
        Several templates are free — more unlock with Talentrah Credits as
        you need them.
      </p>
    </div>
  );
}
