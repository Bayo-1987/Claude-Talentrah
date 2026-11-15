/**
 * What the push work must not change in the normal worker: the code that answers (or declines) ordinary navigations. These pieces of the served script are pinned by SHA-256 of their exact text, taken
 * from main before the push handlers existed. A comment line or a space inside one of them moves the digest, so "behaviour is the same" cannot drift into "bytes are the same, nearly".
 *
 * The install listener is pinned with its comment lines removed: the push work moved one explanatory comment out of the served string (to save the person bytes), and nothing else in it changed.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WORKER_SOURCE } from "@/lib/pwa/service-worker-source";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const functionText = (name: string) => {
  const start = WORKER_SOURCE.indexOf(`function ${name}(`);
  const end = WORKER_SOURCE.indexOf("\n}\n", start) + 3;
  return start === -1 ? "" : WORKER_SOURCE.slice(start, end);
};
const listenerText = (event: string) => {
  const start = WORKER_SOURCE.indexOf(`self.addEventListener("${event}"`);
  const end = WORKER_SOURCE.indexOf("\n});\n", start) + 5;
  return start === -1 ? "" : WORKER_SOURCE.slice(start, end);
};
const lineText = (prefix: string) => (WORKER_SOURCE.split("\n").find((line) => line.startsWith(prefix)) ?? "") + "\n";
const withoutCommentLines = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

const PIECE_DIGESTS: Array<[string, () => string, string]> = [
  ["isPassThroughPath", () => functionText("isPassThroughPath"), "9c3b6e9a94aa40ca04ca48ea7879fe6b147d749c0ee33c854de8935ae3066263"],
  ["shouldAnswer", () => functionText("shouldAnswer"), "92a22f61e305f59fe9974f6644b21a4136cc7a768e237020db4a48c5dfed2b8c"],
  ["the fetch listener", () => listenerText("fetch"), "a6c02329c742c1115981b5f94a88df94236cc55c92f5054fc615b0a6b31a273e"],
  ["the activate listener", () => listenerText("activate"), "6017f8807a646c01a35511392821d4a76c81c9c45354a14fd95671efb41401ff"],
  ["the install listener, comment lines removed", () => withoutCommentLines(listenerText("install")), "18ad8426b825931755cf0fe6f492be39043c8626c6e7c431266817b3deba045d"],
  ["the PASS_THROUGH list", () => lineText("var PASS_THROUGH = "), "64fc92a5aa54e4ef65942237b22c7d49274bf5456bdd3776422abee6a5087438"],
  ["the cache name", () => lineText("var CACHE = "), "e87b62ae7791ff7c7fefaa24db0f7a07a44cacf7ffb583219dad38a01d39ce8e"],
  ["the offline URL", () => lineText("var OFFLINE_URL = "), "668d157c1685a6046dfcb531a273ae932d1d1a2e5c9ddf1a3a96d2aa8c1eae02"],
];

describe("the normal worker's handling of ordinary traffic is byte-identical to main", () => {
  it.each(PIECE_DIGESTS)("%s", (_name, text, expected) => {
    expect(text().length).toBeGreaterThan(20);
    expect(digest(text())).toBe(expected);
  });
});
