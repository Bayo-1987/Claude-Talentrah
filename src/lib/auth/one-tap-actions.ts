"use server";

import { generateOneTapNonce, type OneTapNonce } from "./one-tap-nonce";

/**
 * Mints a fresh nonce pair for one Google One Tap prompt.
 *
 * Called from the client component right before it initializes Google's
 * Identity Services script — a Server Action rather than a value baked into
 * a Server Component's render, because the pages this renders on (the
 * marketing homepage in particular) are deliberately STATIC (see the long
 * comment on `Home` in src/app/page.tsx: a Server Component reading
 * per-request state there opts the whole route into dynamic rendering).
 * Fetching the nonce from the client, after mount, keeps that page static
 * while still generating a fresh, unguessable nonce per prompt rather than
 * one baked into a build-time HTML shell and reused by every visitor.
 */
export async function getOneTapNonceAction(): Promise<OneTapNonce> {
  return generateOneTapNonce();
}
