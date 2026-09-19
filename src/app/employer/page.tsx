import { redirect } from "next/navigation";
import { getEmployerContext } from "@/lib/employer/membership";
import { getOptionalUser } from "@/lib/auth/require-user";
import { pageMetadata } from "@/lib/seo/site";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { EmployerPublicLanding } from "@/components/employer/employer-public-landing";

/**
 * send-350 — real metadata for the signed-out visitor. Always the public
 * metadata regardless of session: a signed-in visitor never sees it, since
 * the page body below redirects them away before paint — same as every
 * other metadata export on a route that might redirect.
 */
export const metadata = pageMetadata({
  title: "Post Jobs and Hire in Nigeria — Talentrah for Employers",
  description:
    "Create a company profile, post your first job for free, and run ad campaigns to reach job seekers across Nigeria and Africa.",
  path: "/employer",
});

/**
 * Entry point. A signed-out visitor gets the real public marketing page
 * (this route used to be a silent redirect to /login with no content of
 * its own — see employer-public-landing.tsx's own header and robots.ts's
 * comment on this exact path, which anticipated this). A signed-in visitor
 * keeps the existing behaviour exactly: straight to the listings if they
 * have an org, onboarding if not.
 */
export default async function EmployerIndexPage() {
  const session = await getOptionalUser();
  if (!session) {
    return (
      <>
        <MarketingMasthead />
        <EmployerPublicLanding />
        <MarketingFooter />
      </>
    );
  }

  const context = await getEmployerContext();
  redirect(context ? "/employer/jobs" : "/employer/onboarding");
}
