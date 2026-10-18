import { PAPER_HEX } from "@/lib/pwa/colors";

/**
 * The page the service worker shows when a navigation cannot reach the network: one complete HTML document, with everything it needs inside it.
 *
 * WHY A STRING AND NOT A PAGE. The worker caches this ONE URL at install and serves it later, possibly weeks later, possibly after a deploy that
 * deleted every `/_next` chunk the cached copy once pointed at. A normal page would load its CSS and JS from those chunks; offline they are
 * gone, a Next page shows unstyled, and a JavaScript retry button is dead. So this has no external request of any kind: no stylesheet, no
 * script, no `/_next` chunk, no web font, no image file, no favicon fetch (the icon link is an empty `data:` URL, which the browser does not
 * request). tests/pwa/offline-page.test.ts reads the HTML and fails on any reference that is not inline.
 *
 * THE RETRY IS A PLAIN LINK, not a button with a script. An `<a href="">` resolves to the current document's URL, and when the worker answered
 * a navigation to /jobs with this page, the document URL is /jobs: the link re-requests the page the person wanted. With no network it comes
 * straight back here; with one, they get the page. No JavaScript, so nothing here can be broken by a deploy.
 *
 * SYSTEM FONT STACKS. The brand fonts are separate woff2 files; precaching one would cost a request at install on the same low-end, metered
 * connections this app is built for, and the worker is deliberately minimal (docs/pwa.md has the sizing). Georgia and Arial are the repo's own
 * fallbacks for Newsreader and IBM Plex Sans (globals.css), so the page reads as the same family of type.
 *
 * COLOURS are the design tokens as hex (an inline style in a file nothing builds cannot use the CSS variables). Each is pinned to its token by
 * tests/pwa/offline-page.test.ts.
 *
 * Editorial rules: no border-radius, no emoji, no shadow, the link styled as a button at least 44px high.
 */
export const OFFLINE_PALETTE = {
  paper: PAPER_HEX, // --paper  oklch(98% 0.004 90)
  ink: "#101c28", //   --ink    oklch(22% 0.03 250)
  inkSoft: "#414f5d", // --ink-soft oklch(42% 0.03 250)
  rust: "#a94620", //  --rust   oklch(52% 0.14 40)
  rustHover: "#923002", // --rust-hover oklch(45% 0.14 40)
  line: "#c9ced4", //  --line   oklch(85% 0.01 250)
} as const;

const P = OFFLINE_PALETTE;

export const OFFLINE_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="${P.paper}">
<title>You are offline — Talentrah</title>
<link rel="icon" href="data:,">
<style>
*{box-sizing:border-box;border-radius:0}
html{background:${P.paper}}
body{margin:0;min-height:100vh;background:${P.paper};color:${P.ink};font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;-webkit-text-size-adjust:100%}
main{max-width:560px;margin:0 auto;padding:56px 24px 64px}
.mark{display:block;width:40px;height:40px;margin:0 0 40px}
.eyebrow{margin:0 0 12px;color:${P.rust};font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}
h1{margin:0 0 16px;font-family:Georgia,"Times New Roman",serif;font-size:36px;font-weight:500;line-height:1.15}
p{margin:0 0 16px;color:${P.inkSoft}}
.rule{height:1px;margin:32px 0;background:${P.line};border:0}
.retry{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 24px;border:1.5px solid ${P.ink};background:${P.ink};color:${P.paper};font-family:inherit;font-size:15px;font-weight:600;text-decoration:none}
.retry:hover{background:${P.rustHover};border-color:${P.rustHover}}
.retry:focus-visible{outline:3px solid ${P.rust};outline-offset:3px}
</style>
</head>
<body>
<main>
<svg class="mark" viewBox="0 0 100 100" role="img" aria-label="Talentrah">
<rect x="14" y="14" width="46" height="20" rx="5" fill="#1d140f"/>
<rect x="40" y="34" width="20" height="52" rx="5" fill="#1d140f"/>
<rect x="54" y="8" width="26" height="26" rx="5" fill="#a94620"/>
</svg>
<p class="eyebrow">Offline</p>
<h1>You are offline.</h1>
<p>This phone cannot reach Talentrah right now. Pages are not saved on this phone, so there is nothing to show until you are back online.</p>
<p>Check your connection, then try again. You will be taken to the page you were trying to open.</p>
<hr class="rule">
<a class="retry" href="">Try again</a>
</main>
</body>
</html>
`;
