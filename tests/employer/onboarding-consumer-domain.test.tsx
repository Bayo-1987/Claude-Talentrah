/**
 * What the onboarding screen tells an employer BEFORE they do the work.
 *
 * ── THE GAP THIS CLOSES ───────────────────────────────────────────────────
 *
 * An account at a personal provider cannot be verified by anything typed into
 * the domain field: `evaluateDomainVerification` compares the claimed domain
 * against the ACCOUNT'S OWN email domain, so `gmail.com` is refused as a
 * consumer domain and a real company domain is a mismatch. There is no third
 * answer.
 *
 * The only warning this screen had was the unconfirmed-email one — which never
 * fires for a Google OAuth signup, because their address arrives already
 * confirmed. So exactly the people who can never verify this way saw nothing,
 * created a company, wrote a job, posted it, and found out on Jobs Posted.
 *
 * Three states, and the third is the one that regressions come from: the
 * ordinary confirmed work-email account must see NEITHER warning. A fix that
 * shows a scary banner to everyone would pass a test that only checked the
 * first two.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OrgOnboardingForm } from "@/components/employer/org-onboarding-form";
import {
  evaluateDomainVerification,
  isConsumerEmailDomain,
  emailDomain,
} from "@/lib/employer/verification";

// The form is a client component whose actions are irrelevant to its copy.
vi.mock("@/lib/employer/actions", () => ({
  createOrganizationAction: vi.fn(),
  joinOrganizationAction: vi.fn(),
}));

const CONSUMER_WARNING = "personal email provider";
const UNCONFIRMED_WARNING = "Confirm your email address to get your company verified";
const OLD_PROMISE = "the matching company domain to be verified now";

function render(props: {
  userEmail: string | null;
  emailConfirmed: boolean;
  consumerEmailDomain: boolean;
}) {
  return renderToStaticMarkup(
    <OrgOnboardingForm
      joinable={[]}
      suggestedDomain={null}
      userEmail={props.userEmail}
      emailConfirmed={props.emailConfirmed}
      consumerEmailDomain={props.consumerEmailDomain}
    />,
  );
}

describe("the rule the copy is describing", () => {
  it("really is unverifiable — no domain value verifies a gmail account", () => {
    // The premise, asserted rather than assumed. If this ever stops being
    // true, the honest message below becomes the dishonest one.
    for (const claimed of ["gmail.com", "zariadigital.com", "example.co.uk", ""]) {
      const outcome = evaluateDomainVerification({
        userEmail: "someone@gmail.com",
        emailConfirmed: true,
        claimedDomain: claimed,
      });
      expect(outcome.verified, `claimed=${claimed || "(empty)"}`).toBe(false);
    }
    expect(isConsumerEmailDomain(emailDomain("someone@gmail.com"))).toBe(true);
  });
});

describe("what the screen says", () => {
  it("a confirmed personal-provider account is told so, up front", () => {
    const html = render({
      userEmail: "someone@gmail.com",
      emailConfirmed: true,
      consumerEmailDomain: true,
    });
    expect(html).toContain(CONSUMER_WARNING);
    // …and names both of the routes: CAC verification is real (0116/0120,
    // submitted from Company Profile once the company exists), so this
    // screen must not still call it unavailable — only the teammate-invite
    // route remains unbuilt, and that is the one claim that gets to say so.
    expect(html).toContain("teammate");
    expect(html).toContain("CAC");
    expect(html).toContain("Company Profile");
    expect(html).toContain("still coming");
    expect(html).not.toContain("Neither is available yet");
    // The old promise must be gone for this account specifically.
    expect(html).not.toContain(OLD_PROMISE);
  });

  it("keeps the domain field — it is still stored, and still matters later", () => {
    const html = render({
      userEmail: "someone@gmail.com",
      emailConfirmed: true,
      consumerEmailDomain: true,
    });
    expect(html).toContain('name="domain"');
    expect(html).toContain("Company website domain");
  });

  it("an unconfirmed work-email account still sees today's message, unchanged", () => {
    const html = render({
      userEmail: "someone@zariadigital.com",
      emailConfirmed: false,
      consumerEmailDomain: false,
    });
    expect(html).toContain(UNCONFIRMED_WARNING);
    expect(html).not.toContain(CONSUMER_WARNING);
  });

  it("a confirmed work-email account — the common case — sees NEITHER warning", () => {
    /*
     * The regression guard. A change that showed the consumer message to
     * everyone would satisfy both tests above and be wrong here, on the
     * account that verifies immediately and needs no warning at all.
     */
    const html = render({
      userEmail: "someone@zariadigital.com",
      emailConfirmed: true,
      consumerEmailDomain: false,
    });
    expect(html).not.toContain(CONSUMER_WARNING);
    expect(html).not.toContain(UNCONFIRMED_WARNING);
    // This account keeps the original promise, because for them it is true.
    expect(html).toContain(OLD_PROMISE);
  });

  it("both warnings can appear together — they are different facts", () => {
    // Unconfirmed AND on a personal provider. Neither message makes the other
    // redundant: one is about proving the address, one about what that address
    // can ever prove.
    const html = render({
      userEmail: "someone@gmail.com",
      emailConfirmed: false,
      consumerEmailDomain: true,
    });
    expect(html).toContain(UNCONFIRMED_WARNING);
    expect(html).toContain(CONSUMER_WARNING);
  });
});
