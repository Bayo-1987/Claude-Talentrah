"use client";

/**
 * Fires a click event for a promoted job card, without turning the whole
 * card (or `JobCard` itself) into a client component. Only ever mounted
 * around a card that IS promoted (see job-card.tsx's own call site) — a
 * non-sponsored card ships zero extra client JS for this.
 *
 * ── ONE DELEGATED LISTENER, NOT A HANDLER ON EACH CONTROL ─────────────────
 *
 * The task this exists for names two distinct activations: the card's own
 * title link, and the "Apply" control. Both already exist deep inside
 * `JobCard`'s markup as a plain `<Link>` and a form `<button>`/anchor — rather
 * than rewriting either into something that can carry an onClick (and losing
 * native affordances like middle-click/right-click "open in new tab" on the
 * title link in the process), this wraps the whole rendered card in one
 * delegated click listener and only reacts when the click's target sits
 * inside an element explicitly marked `data-ad-click` — see job-card.tsx for
 * the two places that attribute is set. Everything else in the card (Save,
 * Share, Report, Ask Farah) is unmarked and produces no event here at all.
 *
 * ── fetch(..., { keepalive: true }) is PRIMARY, sendBeacon is the fallback —
 *    the reverse of the usual advice, and deliberate ──────────────────────
 *
 * The title link's click immediately starts a real navigation. A plain,
 * non-keepalive `fetch()` racing that navigation can be — and in practice
 * sometimes is — cancelled by the browser before the request leaves, which
 * is exactly the scenario both `keepalive: true` and `navigator.sendBeacon`
 * exist to survive.
 *
 * `sendBeacon` is usually recommended first for this pattern, but it was
 * tried here first and DROPPED THE SESSION COOKIE — a live check against this
 * route returned 401 from a beacon call that carried no credentials, while
 * an identical `fetch(..., { credentials: "same-origin" })` from the same
 * page succeeded. `record_ad_event` is authenticated by design (the caller's
 * session decides whose click this is), so a mechanism that silently drops
 * the cookie is worse than one with a smaller theoretical delivery
 * guarantee. `fetch` with `keepalive: true` is the modern, credentialed
 * alternative for exactly this "survive navigation" use case; `sendBeacon`
 * is kept only as a last-resort fallback for a browser old enough to lack
 * `fetch`'s `keepalive` option.
 *
 * Never calls `preventDefault`. This only ever observes a click already
 * headed somewhere; delaying or blocking that navigation to wait on a
 * tracking beacon would make an ad-analytics concern visible as UI lag.
 */
export function PromotedClickTracker({
  campaignId,
  jobPostingId,
  children,
}: {
  campaignId: string;
  jobPostingId: string;
  children: React.ReactNode;
}) {
  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (!target.closest("[data-ad-click]")) return;

    const payload = JSON.stringify({ campaignId, jobPostingId });

    if (typeof fetch === "function") {
      fetch("/api/ads/click", {
        method: "POST",
        body: payload,
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        keepalive: true,
      }).catch(() => {
        // Best-effort. A dropped click event is a gap in analytics, not a
        // reason to disrupt whatever the click was already doing.
      });
      return;
    }

    // Last-resort fallback only — see this file's own header for why this
    // isn't the primary mechanism despite the usual advice.
    try {
      navigator.sendBeacon?.("/api/ads/click", new Blob([payload], { type: "application/json" }));
    } catch {
      // Nothing left to fall back to.
    }
  }

  return <div onClick={handleClick}>{children}</div>;
}
