import { createHash } from "node:crypto";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Canonicalization key per build-prompt §6.12: company + title + location. */
export function computeDedupFingerprint(
  companyName: string,
  title: string,
  location: string | undefined,
): string {
  const key = [normalize(companyName), normalize(title), normalize(location ?? "")].join(
    "|",
  );
  return createHash("sha256").update(key).digest("hex");
}
