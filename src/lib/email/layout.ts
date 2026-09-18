import { absoluteUrl } from "@/lib/seo/site";

/**
 * The shared visual layer for every transactional and digest email this app
 * sends — extracted from `src/lib/digest/template.ts`, the one email that was
 * already doing this right. This is a promotion of what already worked, not
 * a redesign: every color below is that file's own already-chosen value,
 * reused rather than re-derived. Hex, not this app's oklch design tokens —
 * oklch() has poor email-client support, which is presumably why the digest
 * template used hex in the first place, and a second independent
 * approximation of the same palette is exactly how two "brand blue"s happen.
 *
 * Table-free, inline-styled, no web fonts anywhere in here: mail clients
 * will not load Editorial's Google-served serif, so callers ask for a serif
 * stack and accept what they get rather than shipping a font nobody renders.
 */
export const EMAIL_COLORS = {
  background: "#f7f3ec",
  ink: "#2b2119",
  inkMuted: "#6b5c50",
  bodyMuted: "#5a4a3f",
  accent: "#6b4a3a",
  line: "#d9cfc2",
} as const;

const SANS = "-apple-system,Segoe UI,Roboto,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

/** Escapes for HTML text nodes and attribute values alike. */
export function escEmail(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A paragraph in the standard body-copy style. `html` is caller-supplied,
 * already-safe markup (escape any interpolated value with `escEmail` first)
 * — this does not escape for you, the same way a template's outer `<p>`
 * never did.
 */
export function emailParagraph(html: string, opts?: { muted?: boolean }): string {
  const color = opts?.muted ? EMAIL_COLORS.inkMuted : EMAIL_COLORS.ink;
  return `<p style="font:400 15px/1.6 ${SANS};color:${color};">${html}</p>`;
}

/** A small, muted footnote line — e.g. a signoff that should read as quieter than the body. */
export function emailFootnote(html: string): string {
  return `<p style="font:400 12px/1.5 ${SANS};color:${EMAIL_COLORS.inkMuted};">${html}</p>`;
}

/** A serif headline treatment — a job title, a session's date/time, anything that should read as the one specific fact in an otherwise sans-serif email. */
export function emailHeadline(html: string): string {
  return `<div style="font:500 17px/1.35 ${SERIF};color:${EMAIL_COLORS.ink};margin-top:2px;">${html}</div>`;
}

/** The small bold rust-toned label above a headline — a match tier, a session type. */
export function emailLabel(html: string): string {
  return `<div style="font:600 13px/1.4 ${SANS};color:${EMAIL_COLORS.accent};">${html}</div>`;
}

/** The one CTA button pattern every email here uses — no border-radius, matching the design system's own button rule. */
export function emailButton(label: string, url: string): string {
  return `<p style="margin:24px 0;">
      <a href="${escEmail(url)}"
         style="display:inline-block;background:${EMAIL_COLORS.ink};color:${EMAIL_COLORS.background};text-decoration:none;
                padding:12px 20px;font:600 14px/1 ${SANS};">
        ${escEmail(label)}
      </a>
    </p>`;
}

export interface RenderBrandedEmailParams {
  /**
   * The Talentrah mark at the top of the email — off by default, matching
   * the digest (a frequent, expected send that reasonably skips it). Turn
   * on for a one-time or otherwise significant moment, where a recognizable
   * header carries more weight. Most mail clients block remote images by
   * default, so this is always a bonus, never load-bearing — `bodyHtml`
   * must read fine with the image's alt text alone.
   */
  logo?: boolean;
  /** Pre-built HTML for the body — one or more of this file's own paragraph/headline/label/button blocks (or a caller's own custom block, e.g. a table), in order. */
  bodyHtml: string;
  /**
   * Optional HTML appended after the body, inside a muted, divided footer
   * (e.g. an unsubscribe line). Omit for a genuinely transactional email
   * that has no such link — an unsubscribe footer only belongs on a
   * recurring, opt-out-able send like the digest.
   */
  footerHtml?: string;
}

function logoUrl(): string {
  return absoluteUrl("/icons/talentrah-mark-48.png");
}

export function renderBrandedEmail({ logo = false, bodyHtml, footerHtml }: RenderBrandedEmailParams): string {
  const logoBlock = logo
    ? `<img src="${escEmail(logoUrl())}" width="40" height="40" alt="Talentrah" style="display:block;border:0;margin-bottom:20px;" />`
    : "";
  const footerBlock = footerHtml
    ? `<p style="font:400 12px/1.5 ${SANS};color:${EMAIL_COLORS.inkMuted};border-top:1px solid ${EMAIL_COLORS.line};padding-top:12px;">${footerHtml}</p>`
    : "";

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:${EMAIL_COLORS.background};">
  <div style="max-width:560px;margin:0 auto;">
    ${logoBlock}${bodyHtml}
    ${footerBlock}
  </div>
</body></html>`;
}
