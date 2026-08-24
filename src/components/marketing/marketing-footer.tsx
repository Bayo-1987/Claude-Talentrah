import {
  FaLinkedinIn,
  FaXTwitter,
  FaFacebookF,
  FaInstagram,
  FaThreads,
  FaTiktok,
  FaRedditAlien,
} from "react-icons/fa6";
import type { IconType } from "react-icons";

/*
 * Every entry here must be something that actually exists. Anything without
 * a real href renders as a dead `#` anchor, which for an unbuilt feature
 * means the footer advertises a product we don't have — "Auto-Apply",
 * "Mentorship", "Post a Job", "Advertise with Us" and "Employer Login" all
 * did exactly that. "Employer Login" was the worst of them: it implies an
 * employer account system exists to log into. Removed rather than reworded;
 * add each back when the feature ships, with a real href.
 *
 * The employer column keeps its place — §6.1 wants employers addressed in
 * the footer — but now points at the only route that can actually serve one
 * today, which is Contact.
 */
const FOOTER_COLUMNS = [
  {
    heading: "Product",
    links: [
      "Job Matching",
      "Resume Builder",
      "Resume Tailoring",
      "Job Tracker",
      "Scholarships",
      "Refer & Earn",
    ],
  },
  {
    heading: "For Employers",
    links: [{ label: "Hire through Talentrah", href: "/contact" }],
  },
  {
    heading: "Company & Support",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
      { label: "Blog", href: "/blog" },
    ],
  },
  {
    heading: "Legal & Trust",
    links: [
      { label: "Privacy Policy", href: "/legal/privacy" },
      { label: "Terms of Service", href: "/legal/terms" },
      { label: "Data & Cookie Notice", href: "/legal/data-cookie-notice" },
    ],
  },
];

const footerLinkClass =
  "font-body text-[14.5px] font-medium text-[oklch(80%_0.015_60)] no-underline hover:text-paper hover:underline";

interface CommunityLink {
  key: string;
  url: string | undefined;
  label: string;
  icon: React.ReactNode;
}

const COMMUNITY_LINKS: CommunityLink[] = [
  {
    key: "whatsapp",
    url: process.env.NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL,
    label: "WhatsApp Community",
    icon: (
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M4 4h12v9H8l-4 3V4Z"
          stroke="oklch(75% 0.015 60)"
          strokeWidth="1.4"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    ),
  },
  {
    key: "telegram",
    url: process.env.NEXT_PUBLIC_TELEGRAM_CHANNEL_URL,
    label: "Telegram Channel",
    icon: (
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M3 10.5 L17 4 L13 17 L9.5 11.5 L3 10.5Z"
          stroke="oklch(75% 0.015 60)"
          strokeWidth="1.3"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    ),
  },
];

interface SocialLink {
  key: string;
  url: string | undefined;
  label: string;
  Icon: IconType;
}

/**
 * Font Awesome 6 (via react-icons/fa6) — the only library already vetted for
 * this project with accurate, current glyphs for X and Threads, which older
 * icon sets (e.g. lucide-react) don't cover consistently. Bare-mark variants
 * (FaLinkedinIn, FaFacebookF, FaRedditAlien) chosen over the badged/circle
 * versions to match the existing WhatsApp/Telegram icons' plain-line style —
 * no brand-colored badges anywhere in the Editorial system.
 */
const SOCIAL_LINKS: SocialLink[] = [
  { key: "linkedin", url: process.env.NEXT_PUBLIC_LINKEDIN_URL, label: "LinkedIn", Icon: FaLinkedinIn },
  { key: "x", url: process.env.NEXT_PUBLIC_X_URL, label: "X (Twitter)", Icon: FaXTwitter },
  { key: "facebook", url: process.env.NEXT_PUBLIC_FACEBOOK_URL, label: "Facebook", Icon: FaFacebookF },
  { key: "instagram", url: process.env.NEXT_PUBLIC_INSTAGRAM_URL, label: "Instagram", Icon: FaInstagram },
  { key: "threads", url: process.env.NEXT_PUBLIC_THREADS_URL, label: "Threads", Icon: FaThreads },
  { key: "tiktok", url: process.env.NEXT_PUBLIC_TIKTOK_URL, label: "TikTok", Icon: FaTiktok },
  { key: "reddit", url: process.env.NEXT_PUBLIC_REDDIT_URL, label: "Reddit", Icon: FaRedditAlien },
];

export function MarketingFooter() {
  const communityLinks = COMMUNITY_LINKS.filter((l): l is CommunityLink & { url: string } => !!l.url);
  const socialLinks = SOCIAL_LINKS.filter((l): l is SocialLink & { url: string } => !!l.url);

  return (
    <div className="bg-ink pb-8 pt-16">
      <div className="mx-auto max-w-[1120px] px-10">
        <div className="flex flex-wrap items-center justify-between gap-6 pb-10">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG, next/image's optimizer needs SVG allow-listing for no real benefit here */}
              <img
                src="/talentrah-mark-reversed.svg"
                alt=""
                width={100}
                height={100}
                className="h-7 w-7"
              />
              <span className="font-display text-[21px] font-medium text-paper">Talentrah</span>
            </div>
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
              {col.links.map((link) => {
                const label = typeof link === "string" ? link : link.label;
                const href = typeof link === "string" ? "#" : link.href;
                return (
                  <a key={label} href={href} className={footerLinkClass}>
                    {label}
                  </a>
                );
              })}
            </div>
          ))}
        </div>

        {communityLinks.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-6 border-b border-ink-line py-7">
            <span className="font-body text-[12px] font-bold uppercase tracking-[0.1em] text-[oklch(60%_0.02_60)]">
              Join the community
            </span>
            <div className="flex flex-wrap items-center gap-7">
              {communityLinks.map((link) => (
                <a
                  key={link.key}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${footerLinkClass} flex items-center gap-2`}
                >
                  {link.icon}
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        )}

        {socialLinks.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-6 border-b border-ink-line py-7">
            <span className="font-body text-[12px] font-bold uppercase tracking-[0.1em] text-[oklch(60%_0.02_60)]">
              Follow us
            </span>
            <div className="flex flex-wrap items-center gap-2.5">
              {socialLinks.map(({ key, url, label, Icon }) => (
                <a
                  key={key}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="flex h-8.5 w-8.5 flex-shrink-0 items-center justify-center border border-ink-line text-[oklch(75%_0.015_60)] transition-colors hover:border-[oklch(75%_0.015_60)] hover:text-paper"
                >
                  <Icon size={15} aria-hidden="true" />
                </a>
              ))}
            </div>
          </div>
        )}

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
