"use client";

import {
  Button,
  EyebrowLabel,
  Card,
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
        <h1 className="text-[36px]">Talentrah — Sunbird primitives</h1>
        <p className="text-ink-soft">
          DM Serif Display for headings, DM Sans for body/UI. Rounded corners and a soft
          shadow on every card; pill-shaped buttons, badges and chips.
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
        <EyebrowLabel size="sm">Colors</EyebrowLabel>
        <div className="flex flex-wrap gap-4">
          {(
            [
              ["bg", "bg-bg", "border border-line"],
              ["card", "bg-card", "border border-line"],
              ["ink", "bg-ink", ""],
              ["coral", "bg-coral", ""],
              ["teal", "bg-teal", ""],
              ["gold", "bg-gold", ""],
              ["green", "bg-green", ""],
              ["amber", "bg-amber", ""],
            ] as const
          ).map(([name, bgClass, extra]) => (
            <div key={name} className="flex flex-col items-center gap-1.5">
              <div className={`h-14 w-14 rounded-full ${bgClass} ${extra}`} />
              <span className="text-[11px] text-ink-soft">{name}</span>
            </div>
          ))}
        </div>
      </section>

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
        <EyebrowLabel size="sm">
          Match tiers — Excellent / Good / Fair, each its own color
        </EyebrowLabel>
        <div className="flex flex-wrap items-center gap-8">
          <MatchTierBadge score={92} variant="display" />
          <MatchTierBadge score={72} variant="display" />
          <MatchTierBadge score={63} variant="display" />
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <MatchTierBadge score={92} />
          <MatchTierBadge score={72} />
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
        <EyebrowLabel size="sm">Cards</EyebrowLabel>
        <div className="flex flex-wrap gap-6">
          <Card className="w-72 p-5">
            <EyebrowLabel size="sm">Sample card</EyebrowLabel>
            <p className="mt-2 text-[14px] text-ink-soft">
              Every card gets a rounded corner and this soft shadow by default — the
              opposite of Editorial, which reserved a shadow for exactly one element.
            </p>
          </Card>
          <Card shadow={false} className="w-72 p-5 border border-line">
            <EyebrowLabel size="sm">Flat card</EyebrowLabel>
            <p className="mt-2 text-[14px] text-ink-soft">
              shadow=false, for a card nested inside another shadowed surface.
            </p>
          </Card>
        </div>
      </section>
    </Container>
  );
}
