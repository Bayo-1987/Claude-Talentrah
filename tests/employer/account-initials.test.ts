/**
 * The initials the employer header's account button shows when there is no organisation badge: the user's own, from the name, else the first letter of the email.
 */
import { describe, expect, it } from "vitest";
import { accountInitials } from "@/lib/profile/name";

describe("accountInitials", () => {
  it.each([
    ["Ada", "Lovelace", "ada@example.test", "AL"],
    ["ada", null, "ada@example.test", "A"],
    [null, null, "zed@example.test", "Z"],
    ["", "   ", " yemi@example.test", "Y"],
    [null, null, "", ""],
    [null, null, null, ""],
  ])("%s %s <%s> -> %s", (first, last, email, expected) => {
    expect(accountInitials(first, last, email)).toBe(expected);
  });
});
