import type { ReactNode } from "react";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { Container, EyebrowLabel } from "@/components/ui";

interface LegalPageProps {
  eyebrow: string;
  title: string;
  lastUpdated: string;
  children: ReactNode;
}

/**
 * Shared shell for /legal/* pages. Prose styling is scoped here (h2/p/ul
 * spacing) rather than pulled from a generic Tailwind "prose" plugin, since
 * this project doesn't have @tailwindcss/typography installed and these
 * three pages don't warrant adding it just for this.
 */
export function LegalPage({ eyebrow, title, lastUpdated, children }: LegalPageProps) {
  return (
    <>
      <MarketingMasthead />
      <div className="py-20">
        <Container className="flex max-w-[760px] flex-col gap-10">
          <div className="flex flex-col gap-4 border-b border-line pb-10">
            <EyebrowLabel>{eyebrow}</EyebrowLabel>
            <h1 className="text-[34px] leading-[1.2]">{title}</h1>
            <p className="text-[13.5px] text-ink-soft">Last updated {lastUpdated}</p>
          </div>
          <div className="flex flex-col gap-6 text-[15px] leading-[1.7] text-ink-soft [&_a]:text-rust [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mt-2 [&_h2]:text-[20px] [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-ink [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
            {children}
          </div>
        </Container>
      </div>
      <MarketingFooter />
    </>
  );
}
