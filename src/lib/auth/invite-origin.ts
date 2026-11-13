/**
 * The origin an invite link is built on (JOBS-POLISH-1, P6). Shared by every invite that mails a link, so none of them carries its own fallback.
 *
 * WHY IT REFUSES. The operator invite used `process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"`. Production did not have the variable, so the link in the owner's invite pointed at their own machine: an
 * email that looks sent and cannot be used. A silent fallback turns a missing setting into a wrong link. In production a missing or blank site URL is now an error the operator sees, and so is one that
 * names this machine (localhost, 127.0.0.1, ::1, *.localhost): either way the invite is NOT sent. Anywhere else (development, test) an unset URL still gives the local default.
 *
 * The origin comes from the environment, never from the request: a redirect target that arrived with the request is one an attacker can choose, and this one is baked into an email that grants a session.
 *
 * "Production" is NODE_ENV, which Vercel also sets for a preview deployment, so a preview with the variable unset refuses too. That is deliberate: a preview's invite must not point at localhost either.
 */

/** What a developer's machine gets when nothing is configured. */
export const DEV_INVITE_ORIGIN = "http://localhost:3000";

export const INVITE_ORIGIN_UNSET_MESSAGE = "Site URL is not configured; the invite was not sent";
export const INVITE_ORIGIN_LOCAL_MESSAGE = "Site URL points at this machine, not the live site; the invite was not sent";

export type InviteOrigin = { ok: true; origin: string } | { ok: false; message: string };

function isThisMachine(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}

export function resolveInviteOrigin(env: { NODE_ENV?: string; NEXT_PUBLIC_SITE_URL?: string } = process.env): InviteOrigin {
  const configured = env.NEXT_PUBLIC_SITE_URL?.trim() ?? "";
  const production = env.NODE_ENV === "production";

  if (configured === "") {
    return production ? { ok: false, message: INVITE_ORIGIN_UNSET_MESSAGE } : { ok: true, origin: DEV_INVITE_ORIGIN };
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    return production ? { ok: false, message: INVITE_ORIGIN_UNSET_MESSAGE } : { ok: true, origin: configured.replace(/\/+$/, "") };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return production ? { ok: false, message: INVITE_ORIGIN_UNSET_MESSAGE } : { ok: true, origin: configured.replace(/\/+$/, "") };
  }
  if (production && isThisMachine(url.hostname)) return { ok: false, message: INVITE_ORIGIN_LOCAL_MESSAGE };
  return { ok: true, origin: url.origin };
}
