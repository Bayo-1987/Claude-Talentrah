import { randomBytes, createHash } from "node:crypto";

/**
 * The nonce pair behind Google One Tap sign-in — see one-tap-actions.ts for
 * how it's handed to the client and one-tap-client.ts for how both halves
 * get used.
 *
 * THIS IS THE CRUX OF THE SECURITY REVIEW FOR THIS FEATURE, so the shape is
 * deliberately two distinct strings rather than one value reused twice:
 *
 *   nonce        the raw, unguessable challenge. Given to Supabase's
 *                `signInWithIdToken` — never to Google.
 *   hashedNonce  SHA-256(nonce), hex-encoded. Given to Google's Identity
 *                Services script — never used to authenticate anything on
 *                its own.
 *
 * Google's One Tap embeds whatever you hand it as `nonce` verbatim into the
 * `nonce` claim of the ID token it signs and returns — so if we handed Google
 * the raw value, that value would sit in plaintext inside a JWT that
 * transits the browser and gets sent back to us as a bearer of sorts. Handing
 * Google the HASH instead means the plaintext raw nonce never leaves this
 * server-to-client trip in a form Google (or anything on the wire to Google)
 * ever sees; Supabase's GoTrue, on receiving `signInWithIdToken`, re-hashes
 * the raw nonce we hand IT and checks that against the `nonce` claim baked
 * into the (Google-signature-verified) ID token. A token whose claim doesn't
 * match SHA-256(nonce-we-supplied) is rejected — that's what stops a captured
 * or replayed ID token from a different challenge being redeemed here.
 *
 * `randomBytes(32)` (256 bits) is generated with Node's CSPRNG, not
 * `Math.random()` or a client-supplied value — a guessable or attacker-
 * influenced nonce defeats the whole point of the check above.
 */
export interface OneTapNonce {
  nonce: string;
  hashedNonce: string;
}

export function generateOneTapNonce(): OneTapNonce {
  const nonce = randomBytes(32).toString("base64url");
  const hashedNonce = createHash("sha256").update(nonce).digest("hex");
  return { nonce, hashedNonce };
}
