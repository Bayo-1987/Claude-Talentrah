import { createHash } from "node:crypto";

/** The rate-limit key for an address: a hash of the lower-cased address, so the table holds no readable copy of it and "ADA@Example.com" is the same address as "ada@example.com". */
export function hashedEmailKey(email: string): string {
  return createHash("sha256").update(`signup-code:${email.trim().toLowerCase()}`).digest("hex");
}
