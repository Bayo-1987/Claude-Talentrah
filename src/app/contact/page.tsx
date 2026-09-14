import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/site";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { Container, EyebrowLabel } from "@/components/ui";
import { getContactRecipient } from "@/lib/resend/client";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = pageMetadata({
  title: "Contact — Talentrah",
  description: "Get in touch with the Talentrah team.",
  path: "/contact",
});

export default function ContactPage() {
  const recipient = getContactRecipient();

  return (
    <>
      <MarketingMasthead />
      <div className="py-20">
        <Container className="grid max-w-[1120px] gap-16 min-[901px]:grid-cols-[1fr_1.2fr]">
          <div className="flex flex-col gap-4">
            <EyebrowLabel>Contact</EyebrowLabel>
            <h1 className="text-[36px] leading-[1.2]">Talk to us.</h1>
            <p className="text-[16px] text-ink-soft">
              Questions about your account, a bug you&apos;ve hit, or want to talk
              about posting jobs or business services? Send us a message and
              we&apos;ll get back to you.
            </p>
            <p className="text-[15px] text-ink-soft">
              Prefer email directly?{" "}
              <a href={`mailto:${recipient}`} className="text-rust underline underline-offset-2">
                {recipient}
              </a>
            </p>
          </div>
          <ContactForm />
        </Container>
      </div>
      <MarketingFooter />
    </>
  );
}
