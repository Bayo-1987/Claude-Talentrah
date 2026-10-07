/**
 * The cookie banner's pre-paint decision (S1-26 item 3).
 *
 * The banner is server-rendered, so it is in the page at first paint and cannot shift anything when it appears. A returning visitor who already
 * chose must not see it flash. This script runs in <body> before the banner is parsed, reads the stored choice, and sets
 * `data-cookie-consent="decided"` on <html>; one CSS rule in globals.css hides the banner on that attribute. It never throws: blocked storage
 * (private browsing) simply means "undecided", and the banner shows, exactly as before.
 *
 * CSP. The site's Content-Security-Policy is Report-Only and allows inline scripts (`script-src 'self' 'unsafe-inline'`, next.config.ts), the same
 * allowance Next.js's own inline bootstrap scripts rely on. When that policy is tightened to nonces or hashes, this script needs the same
 * treatment as those; its text is one exported constant so it can be hashed.
 */
export const COOKIE_CONSENT_STORAGE_KEY = "talentrah-cookie-consent";

export const COOKIE_CONSENT_PREPAINT_SCRIPT = `try{var v=localStorage.getItem(${JSON.stringify(COOKIE_CONSENT_STORAGE_KEY)});if(v==="accepted"||v==="rejected")document.documentElement.setAttribute("data-cookie-consent","decided")}catch(e){}`;
