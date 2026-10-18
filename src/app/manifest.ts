import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_DESCRIPTION } from "@/lib/seo/site";
import { PAPER_HEX } from "@/lib/pwa/colors";

/**
 * The web app manifest, served at /manifest.webmanifest.
 *
 * `start_url: "/dashboard"` is deliberate: that route sends an organisation member to /employer, everyone else to /jobs, and a signed-out
 * visitor to /login with a return trip, so one install works for seekers and employers with no new redirect logic. "/" would open the
 * marketing page for a signed-in person.
 *
 * `id: "/"` pins the app's identity so it never depends on `start_url`.
 *
 * Colours are the --paper token as hex (see src/lib/pwa/colors.ts): a manifest cannot hold oklch.
 *
 * Icons: 192 and 512 for purpose "any" (opaque, on paper; the share image talentrah-mark-512.png is NOT used here and must not change), and a SEPARATE 512 (and 192) for "maskable". Never one image for both purposes: a maskable icon is
 * cropped by the platform and so carries its own opaque background and safe zone (scripts/generate-pwa-icons.ts).
 *
 * Left out of v1 on purpose: screenshots, shortcuts, share_target, related_applications.
 *
 * Static: no request-time API, so Next serves this as a cached route and the manifest never costs a render.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    lang: "en",
    scope: "/",
    start_url: "/dashboard",
    display: "standalone",
    theme_color: PAPER_HEX,
    background_color: PAPER_HEX,
    icons: [
      { src: "/icons/talentrah-mark-any-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/talentrah-mark-any-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/talentrah-mark-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/talentrah-mark-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
