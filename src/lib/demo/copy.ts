/**
 * The homepage demo's one free-claim sentence, in one place.
 *
 * Reality (pinned by tests/marketing/demo-copy.test.tsx): the demo needs no account and allows ONE free
 * preview per visitor (a cookie; there is deliberately no per-IP rule, see tests/demo/jd-demo-route-attempts.test.ts).
 * Scoped at the point the claim is made — CLAUDE.md's copy rule — so nothing else on the page needs to promise it.
 */
export const DEMO_CAPTION_SIGNED_OUT = "Try it free — no account needed. One free preview per visitor.";
