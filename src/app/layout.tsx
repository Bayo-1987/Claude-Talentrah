import type { Metadata } from "next";
import { SITE_ORIGIN } from "@/lib/seo/site";
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

/*
 * The square brand mark, used as the default share image.
 *
 * 512x512 is the largest raster in public/icons, so the Twitter card is
 * declared as `summary` rather than `summary_large_image`: the large card is
 * 1200x630 and centre-crops whatever it is given, which turns a square mark
 * into a sliver of itself. Claiming the wide card without a wide image is the
 * common way share previews end up looking broken.
 *
 * A purpose-made 1200x630 image would allow the large card and is worth doing,
 * but it is a design artefact rather than a technical gap, so it is not
 * invented here.
 */
const SHARE_IMAGE = "/icons/talentrah-mark-512.png";

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
  title: {
    default: SITE_NAME,
    // Pages that set a title get it verbatim; this only fills the gap for any
    // that do not. Job and blog pages already build their own full string.
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: "/",
    locale: "en_NG",
    images: [{ url: SHARE_IMAGE, width: 512, height: 512, alt: `${SITE_NAME} logo` }],
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
