/**
 * An applied migration is never edited. This pins the exact bytes of each migration that has been applied to a hosted project and is still on a branch (or main) as a file: the applied text and the file in the repo must
 * be the same text, so the ledger row's recorded text, the file and a later reader all agree. To change what a migration did, write a NEW migration.
 *
 * Add an entry when a migration is applied and its file is not yet on main; the entry stays after it merges.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** file -> { sha256 of the applied text, where and when it was applied } */
const APPLIED: Record<string, { sha256: string; applied: string }> = {
  "supabase/migrations/0223_llm_daily_usage.sql": {
    sha256: "067445111286dcadb10cfef8d11bfb531ec7b220dff7a345f46e8c94c46eaadb",
    applied: "preview project, 4 Oct 2026 about 21:58Z, by the hash-checked apply wrapper (the wrapper checks this same hash before it runs the text)",
  },
};

describe("applied migrations are not edited", () => {
  it.each(Object.entries(APPLIED))("%s is byte-identical to the text that was applied", (file, { sha256: expected, applied }) => {
    const text = readFileSync(join(ROOT, file), "utf8");
    expect(sha256(text), `${file} no longer matches the applied text (${applied}). Do not edit an applied migration: add a new one.`).toBe(expected);
  });

  it("the check can fail: a one-character change to the text gives a different hash", () => {
    const [file, { sha256: expected }] = Object.entries(APPLIED)[0];
    const text = readFileSync(join(ROOT, file), "utf8");
    expect(sha256(text.replace("0223", "0224"))).not.toBe(expected);
    expect(sha256(text + "\n")).not.toBe(expected);
    expect(sha256(text.slice(0, -1))).not.toBe(expected);
  });
});
