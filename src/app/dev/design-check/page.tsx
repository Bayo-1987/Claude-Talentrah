"use client";

import {
  Button,
  EyebrowLabel,
  BorderedCard,
  IconButton,
  FilterChip,
  MatchTierBadge,
  Container,
} from "@/components/ui";

/**
 * Design-system verification page — dev-only. Moved off `/` once the real
 * marketing landing page landed there; kept here (not deleted) for QA
 * spot-checks against the primitives. Not linked from anywhere a real
 * visitor would land on — reach it by URL only.
 */
export default function DesignCheckPage() {
  return (
    <Container className="flex flex-col gap-16 py-16">
      <div className="flex flex-col gap-2">
        <EyebrowLabel>Design system check</EyebrowLabel>
        <h1 className="text-[36px]">Talentrah — Editorial primitives</h1>
        <p className="text-ink-soft">
          Newsreader for display, Source Sans 3 for body/UI. No border-radius
          anywhere except circular affordances.
        </p>
        <div className="mt-2 flex gap-4 text-[13.5px]">
          <a href="/signup" className="underline">
            Signup page →
          </a>
          <a href="/login" className="underline">
            Login page →
          </a>
        </div>
      </div>

      <section className="flex flex-col gap-4">
        <EyebrowLabel size="sm">Buttons — marketing scale</EyebrowLabel>
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="primary">Get started for free</Button>
          <Button variant="secondary">Browse all jobs →</Button>
          <Button variant="ghost">Log in</Button>
        </div>
        <EyebrowLabel size="sm">Buttons — app scale</EyebrowLabel>
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="primary" size="sm">
            Apply
          </Button>
          <Button variant="text" size="sm">
            Ask Farah
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <EyebrowLabel size="sm">Match tiers</EyebrowLabel>
        <div className="flex flex-wrap items-center gap-8">
          <MatchTierBadge score={92} variant="display" />
          <MatchTierBadge score={78} variant="display" />
          <MatchTierBadge score={63} variant="display" />
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <MatchTierBadge score={92} />
          <MatchTierBadge score={78} />
          <MatchTierBadge score={63} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <EyebrowLabel size="sm">Filter chips</EyebrowLabel>
        <div className="flex flex-wrap gap-2">
          <FilterChip label="Product" onRemove={() => {}} />
          <FilterChip label="Senior" onRemove={() => {}} />
          <FilterChip label="Remote" onRemove={() => {}} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <EyebrowLabel size="sm">Icon buttons</EyebrowLabel>
        <div className="flex items-center gap-3">
          <IconButton aria-label="Save">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <path
                d="M10 16.5 C6 13.5 2.5 10.8 2.5 7.3 A3.8 3.8 0 0 1 10 5.3 A3.8 3.8 0 0 1 17.5 7.3 C17.5 10.8 14 13.5 10 16.5Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
          </IconButton>
          <IconButton aria-label="Share">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <circle cx="15" cy="5" r="2.2" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="5" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="15" cy="15" r="2.2" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M7 8.8 L13 6.2 M7 11.2 L13 13.8"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
          </IconButton>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <EyebrowLabel size="sm">Bordered card + one shadow instance</EyebrowLabel>
        <div className="flex flex-wrap gap-6">
          <BorderedCard className="w-72 p-5">
            <EyebrowLabel size="sm">Sample card</EyebrowLabel>
            <p className="mt-2 text-[14px] text-ink-soft">
              Plain bordered card, no shadow.
            </p>
          </BorderedCard>
          <BorderedCard shadow className="w-72 p-5">
            <EyebrowLabel size="sm">Hero input box</EyebrowLabel>
            <p className="mt-2 text-[14px] text-ink-soft">
              The only element in the system with a shadow.
            </p>
          </BorderedCard>
        </div>
      </section>
    </Container>
  );
}
