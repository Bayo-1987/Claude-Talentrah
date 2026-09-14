import type { Metadata } from "next";
import { SITE_ORIGIN, SHARE_IMAGE, SHARE_IMAGE_META } from "@/lib/seo/site";
import { Newsreader, Source_Sans_3 } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
});

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-source-sans",
});

const SITE_NAME = "Talentrah";
const SITE_DESCRIPTION =
  "AI-powered career platform for job seekers in Nigeria and across Africa.";


export const metadata: Metadata = {
  /*
   * Required for every relative URL in this file and in each page's own
   * metadata to resolve. Without it Next emits relative og:url / og:image,
   * which crawlers cannot follow — and it warns at build time rather than
   * failing, so it stays missing quietly.
   *
   * See lib/seo/site.ts for why this is a fixed canonical origin and not
   * derived from VERCEL_URL.
   */
  metadataBase: new URL(SITE_ORIGIN),
  /*
   * A plain string, NOT a `template`.
   *
   * A `%s — Talentrah` template is the obvious thing to add here and it is
   * wrong for this codebase: 37 pages already write their own full title
   * ending in "— Talentrah", so the template appends a second one and every
   * tab reads "Jobs — Talentrah — Talentrah". Caught on the job page before
   * this shipped.
   *
   * The convention is that a page owns its whole title. Changing that means
   * editing 37 files, which is a refactor rather than a metadata fix.
   */
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  /*
   * Google Search Console ownership, rendered by Next as
   * <meta name="google-site-verification" content="…">.
   *
   * HERE AND NOT IN pageMetadata(). That helper is per-PAGE — seven pages call
   * it to build their own title, canonical and og tags — so putting the token
   * there would stamp it on those seven and omit it everywhere else, including
   * pages Search Console is just as likely to fetch. Ownership is a property
   * of the site, so it belongs in the one object that is a property of the
   * site.
   *
   * The value is public by design: it is served in the HTML of every page for
   * Google to read. It proves control of this property to Google and grants
   * nothing to anyone who copies it, so it is committed rather than kept in an
   * env var — a secret-shaped thing that is not a secret is worse hidden,
   * because the next person has to work out which it is.
   */
  verification: {
    google: "immMtQL4Q_POb0tDh4mrsti5K_1gsiqszQsExvZIbz0",
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: "/",
    locale: "en_NG",
    images: [SHARE_IMAGE_META],
  },
  twitter: {
    card: "summary",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [SHARE_IMAGE],
  },
  icons: {
    icon: [
      { url: "/icons/talentrah-mark-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/talentrah-mark-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/talentrah-mark-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icons/talentrah-mark-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/talentrah-mark-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${sourceSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
