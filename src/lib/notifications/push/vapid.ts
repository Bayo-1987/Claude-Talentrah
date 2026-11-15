import { createECDH } from "node:crypto";

/**
 * The three VAPID variable names. The public key has ONE copy: the page (which subscribes with it) and the sender (which signs with the matching private key) both read NEXT_PUBLIC_VAPID_PUBLIC_KEY.
 * Preview and Production hold different pairs.
 */
export const VAPID_PUBLIC_KEY_ENV = "NEXT_PUBLIC_VAPID_PUBLIC_KEY";
export const VAPID_PRIVATE_KEY_ENV = "VAPID_PRIVATE_KEY";
export const VAPID_SUBJECT_ENV = "VAPID_SUBJECT";

export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

/** Thrown when the sender cannot start. The message names the variable and the problem, never a value. */
export class PushConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushConfigError";
  }
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function decode(value: string): Buffer | null {
  return BASE64URL.test(value) ? Buffer.from(value, "base64url") : null;
}

/** True when the public key is the one the private key derives (prime256v1, the curve VAPID uses). */
export function vapidKeysMatch(publicKey: string, privateKey: string): boolean {
  const pub = decode(publicKey);
  const priv = decode(privateKey);
  if (!pub || !priv || pub.length !== 65 || priv.length !== 32) return false;
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(priv);
    return ecdh.getPublicKey().equals(pub);
  } catch {
    return false;
  }
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new PushConfigError(`push: ${name} is not set`);
  return value;
}

/** Reads and checks the pair. The sender refuses to start on anything it throws here. */
export function readVapidConfig(env: Record<string, string | undefined>): VapidConfig {
  const publicKey = required(env, VAPID_PUBLIC_KEY_ENV);
  const privateKey = required(env, VAPID_PRIVATE_KEY_ENV);
  const subject = required(env, VAPID_SUBJECT_ENV);
  if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) throw new PushConfigError(`push: ${VAPID_SUBJECT_ENV} must start with mailto: or https://`);
  if (!vapidKeysMatch(publicKey, privateKey)) throw new PushConfigError(`push: ${VAPID_PRIVATE_KEY_ENV} does not match ${VAPID_PUBLIC_KEY_ENV}`);
  return { publicKey, privateKey, subject };
}
