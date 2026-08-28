import { AdminScholarshipForm } from "./admin-scholarship-form";
import { Container, EyebrowLabel } from "@/components/ui";

/*
 * Outside the (app) route group on purpose. That layout calls requireUser and
 * wraps everything in the seeker masthead and Farah panel; this page is gated
 * on the shared admin secret, not on a signed-in account, and an operator here
 * is not a job seeker.
 */
export const metadata = {
  title: "Add a scholarship — Talentrah admin",
  // Not a secret, but nothing here should be in an index either.
  robots: { index: false, follow: false },
};

export default function NewScholarshipPage() {
  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <div className="flex flex-col gap-3">
        <EyebrowLabel>Scholarship admin</EyebrowLabel>
        <h1 className="text-[30px] leading-[1.2]">Add a scholarship by hand.</h1>
        <p className="max-w-[620px] text-[15px] text-ink-soft">
          M10&apos;s catalog is hand-curated deliberately — no scraped source is
          relied on until the legal review lands. Until now that meant editing
          the seed file and deploying. This does the same thing without one.
        </p>
        <p className="max-w-[620px] font-display text-[14px] italic text-ink-soft">
          Everything posted here lands pending. Nothing on this page can publish
          a listing to the public catalog.
        </p>
      </div>

      <AdminScholarshipForm />
    </Container>
  );
}
