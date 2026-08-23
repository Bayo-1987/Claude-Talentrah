const FOOTER_COLUMNS = [
  {
    heading: "Product",
    links: [
      "Job Matching",
      "Resume Builder",
      "Resume Tailoring",
      "Auto-Apply",
      "Job Tracker",
      "Mentorship",
      "Refer & Earn",
    ],
  },
  {
    heading: "For Employers",
    links: ["Post a Job", "Advertise with Us", "Employer Login", "Business Services"],
  },
  {
    heading: "Company & Support",
    links: ["About", "Contact", "Blog"],
  },
  {
    heading: "Legal & Trust",
    links: ["Privacy Policy", "Terms of Service", "Data & Cookie Notice"],
  },
];

const footerLinkClass =
  "font-body text-[14.5px] font-medium text-[oklch(80%_0.015_60)] no-underline hover:text-paper hover:underline";

export function MarketingFooter() {
  return (
    <div className="bg-ink pb-8 pt-16">
      <div className="mx-auto max-w-[1120px] px-10">
        <div className="flex flex-wrap items-baseline justify-between gap-6 pb-10">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="font-display text-[21px] font-medium text-paper">Talentrah</span>
            <span className="ml-1.5 font-display text-[14px] italic text-[oklch(70%_0.015_60)]">
              AI-powered career platform for job seekers in Nigeria and across Africa.
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-10 border-y border-ink-line py-10 min-[901px]:grid-cols-4">
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.heading} className="flex flex-col gap-3.5">
              <div className="font-body text-[12px] font-bold uppercase tracking-[0.1em] text-[oklch(60%_0.02_60)]">
                {col.heading}
              </div>
              {col.links.map((label) => (
                <a key={label} href="#" className={footerLinkClass}>
                  {label}
                </a>
              ))}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-6 border-b border-ink-line py-7">
          <span className="font-body text-[12px] font-bold uppercase tracking-[0.1em] text-[oklch(60%_0.02_60)]">
            Join the community
          </span>
          <div className="flex items-center gap-7">
            <a href="#" className={`${footerLinkClass} flex items-center gap-2`}>
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M4 4h12v9H8l-4 3V4Z"
                  stroke="oklch(75% 0.015 60)"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
              WhatsApp Community
            </a>
            <a href="#" className={`${footerLinkClass} flex items-center gap-2`}>
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M3 10.5 L17 4 L13 17 L9.5 11.5 L3 10.5Z"
                  stroke="oklch(75% 0.015 60)"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
              Telegram Channel
            </a>
          </div>
        </div>

        <div className="flex items-center justify-between pt-6">
          <span className="text-[13px] text-[oklch(60%_0.02_60)]">
            © 2026 Talentrah. All rights reserved.
          </span>
          <span className="font-display text-[13px] italic text-[oklch(60%_0.02_60)]">
            Built for job seekers in Nigeria and beyond.
          </span>
        </div>
      </div>
    </div>
  );
}
