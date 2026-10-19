import { utc } from "./email";
import { REFERRER_POLICY } from "./referrer-policy";

/**
 * The two pages of the data export download, as plain HTML strings. They are served by the route handler itself (src/app/data-export/[id]/route.ts), NOT through the app layout, so neither one
 * carries the install strip, the service-worker registration, the analytics or any other script of the signed-in shell: the only script on the confirm page is the few lines below, and the
 * refusal page has none. Neither page names any data (no counts, no table names).
 *
 * The confirm page takes exactly two strings, the export id (for the form's action) and the expiry text, and nothing else: the stored row never reaches the markup.
 */

export interface ConfirmPageProps {
  id: string;
  expiresText: string;
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The refusal sentence, byte for byte what the route has always said. */
export const REFUSAL_SENTENCE = "This link has expired, was already used, or is not for this account. If you still need a copy of your data, contact support.";

/** "2026-10-22 09:30 UTC", the same formatter the link email uses. */
export function expiryText(expiresAt: string): string {
  return utc(new Date(expiresAt));
}

const STYLE = `
:root{--paper:oklch(97% 0.014 85);--ink:oklch(20% 0.018 50);--ink-soft:oklch(38% 0.02 50);--rust:oklch(52% 0.14 40);--card:oklch(99% 0.006 85)}
*{box-sizing:border-box;border-radius:0}
body{margin:0;background:var(--paper);color:var(--ink);font-family:"IBM Plex Sans",system-ui,sans-serif;line-height:1.6}
main{max-width:34rem;margin:0 auto;padding:72px 24px}
.box{background:var(--card);border:2px solid var(--ink);padding:32px}
h1{font-family:Newsreader,Georgia,serif;font-weight:500;font-size:1.75rem;line-height:1.25;margin:0 0 16px}
p{margin:0 0 16px;color:var(--ink-soft)}
.btn{min-height:44px;padding:0 24px;border:0;background:var(--ink);color:var(--paper);font:inherit;font-weight:600;cursor:pointer}
.btn:hover{background:var(--rust)}
.btn:disabled{opacity:.6;cursor:default}
.foot{margin:24px 0 0;font-size:.9rem}
a{color:var(--rust)}
`.replace(/\n/g, "");

// Disables the button on the first submit, so a double-click sends ONE request. The form still works with scripts off: this only sits on top of a plain POST form.
// pageshow puts it back when the browser restores the page from its back/forward cache.
const SCRIPT = `(function(){var f=document.getElementById("dl");if(!f)return;f.addEventListener("submit",function(e){if(f.getAttribute("data-sent")){e.preventDefault();return}f.setAttribute("data-sent","1");var b=f.querySelector("button");if(b)b.disabled=true});window.addEventListener("pageshow",function(e){if(e.persisted){f.removeAttribute("data-sent");var b=f.querySelector("button");if(b)b.disabled=false}})})();`;

const doc = (title: string, body: string, script = ""): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="${REFERRER_POLICY}"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${body}</main>${script ? `<script>${script}</script>` : ""}</body></html>`;

export function renderConfirmPage({ id, expiresText }: ConfirmPageProps): string {
  return doc(
    "Your copy of your Talentrah data",
    `<div class="box"><h1>Your copy of your Talentrah data</h1>` +
      `<p>This file holds the data we keep for your account. You can download it once. After you download it, we delete it from our servers. This link stops working on ${esc(expiresText)} either way.</p>` +
      `<form id="dl" method="post" action="/data-export/${esc(id)}"><button type="submit" class="btn">Download my data</button></form>` +
      `<p class="foot">If you did not ask for this, <a href="/contact">contact us</a>.</p></div>`,
    SCRIPT,
  );
}

export function renderRefusalPage(): string {
  return doc("Talentrah", `<div class="box"><p>${esc(REFUSAL_SENTENCE)}</p></div>`);
}
