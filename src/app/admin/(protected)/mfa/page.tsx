import { requireAdmin } from "@/lib/admin/require-admin";
import { MfaEnrolForm } from "@/components/admin/mfa-enrol-form";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";

export const metadata = {
  title: "Two-factor — Talentrah admin",
  robots: { index: false, follow: false },
};

/**
 * The one page an unenrolled operator can reach.
 *
 * requireAdmin() sends anybody without `mfa_enrolled_at` here and exempts only
 * this path, so enrolment is forced without ever blocking the login that makes
 * it possible.
 */
export default async function MfaPage() {
  const admin = await requireAdmin();
  const enrolled = admin.mfaEnrolledAt !== null;

  return (
    <Container className="flex max-w-[640px] flex-col gap-8 py-12">
      <div className="flex flex-col gap-3">
        <EyebrowLabel>Two-factor authentication</EyebrowLabel>
        <h1 className="text-[30px] leading-[1.2]">
          {enrolled ? "Two-factor is on." : "Set up two-factor to continue."}
        </h1>
        {!enrolled && (
          <p className="max-w-[560px] text-[15px] text-ink-soft">
            Your admin password can be reset by anyone with access to your email
            inbox — that is how password recovery works, and it is not something
            the reset flow should special-case for operators. A second factor is
            what makes that reset insufficient on its own.
          </p>
        )}
      </div>

      {enrolled ? (
        <BorderedCard className="p-5">
          <p className="text-[15px]">
            Enrolled on {new Date(admin.mfaEnrolledAt!).toLocaleDateString()}. You are asked
            for a code every time you sign in here.
          </p>
          <p className="mt-2 font-display text-[13.5px] italic text-ink-soft">
            Lost the device? Another admin can clear it with{" "}
            <code className="not-italic">npm run grant-admin -- --reset-mfa</code>. You cannot
            remove it yourself from a password-only session — that refusal is the point.
          </p>
        </BorderedCard>
      ) : (
        <MfaEnrolForm />
      )}
    </Container>
  );
}
