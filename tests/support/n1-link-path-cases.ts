/**
 * One list of link-path cases for BOTH the database CHECK on an admin message's link and the notifications fake (N1-R29 Q2), so the two cannot drift apart. Each case was also run against the
 * real CHECK by hand for the exotic characters: Postgres refuses every JavaScript whitespace character EXCEPT U+FEFF, plus the C0 and C1 control characters and DELETE; it accepts a zero-width
 * space, U+FEFF, accented letters and CJK.
 */
export const LINK_GOOD: ReadonlyArray<string> = [
  "/",
  "/jobs",
  "/jobs/remote?x=1&y=2#top",
  "/a//b",
  "/mentorship/abc-123",
  "/x".padEnd(200, "x"),
  "/café",
  "/中文",
  "/a​b", // zero-width space is not whitespace to Postgres
  "/a﻿b", // nor is the byte order mark
];

export const LINK_BAD: ReadonlyArray<readonly [name: string, value: string]> = [
  ["absolute url", "https://evil.test/x"],
  ["protocol relative", "//evil.test/x"],
  ["scheme", "javascript:alert(1)"],
  ["no leading slash", "jobs"],
  ["empty", ""],
  ["backslash after the slash", "/\\evil.test"],
  ["backslash later", "/a\\b"],
  ["space", "/a b"],
  ["newline", "/a\nb"],
  ["tab", "/a\tb"],
  ["201 characters", "/".padEnd(201, "x")],
  ["no-break space", "/a b"],
  ["em space", "/a b"],
  ["ideographic space", "/a　b"],
  ["line separator", "/a b"],
  ["delete", "/a\u007fb"],
  ["C1 control", "/a\u0085b"],
];
