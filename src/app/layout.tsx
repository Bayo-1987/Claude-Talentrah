import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "Talentrah",
  description:
    "AI-powered career platform for job seekers in Nigeria and across Africa.",
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
