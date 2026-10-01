/**
 * One achievement per bullet. Text that arrives with its own bullet markers
 * ("• a", "- b", "1. c") or several achievements glued into one string must
 * become separate entries, with the markers gone — a marker left inside the
 * text renders as a fake dash inside a paragraph instead of a real <li>.
 */
import { describe, expect, it } from "vitest";
import { splitAchievements, stripBulletMarker } from "@/lib/resume/achievements";
import { getExperienceBullets, getExperienceText } from "@/lib/resume/types";

describe("stripBulletMarker", () => {
  it.each([
    ["• Led the migration", "Led the migration"],
    ["- Led the migration", "Led the migration"],
    ["– Led the migration", "Led the migration"],
    ["— Led the migration", "Led the migration"],
    ["* Led the migration", "Led the migration"],
    ["· Led the migration", "Led the migration"],
    ["▪ Led the migration", "Led the migration"],
    ["1. Led the migration", "Led the migration"],
    ["2) Led the migration", "Led the migration"],
    ["  •   Led the migration  ", "Led the migration"],
    // No marker -> only trimmed.
    ["Led the migration", "Led the migration"],
    // A hyphen, asterisk or digit that is part of the text is not a marker.
    ["-5% churn in a quarter", "-5% churn in a quarter"],
    ["**Led** the migration", "**Led** the migration"],
    ["*Led* the migration", "*Led* the migration"],
    ["24/7 on-call rotation", "24/7 on-call rotation"],
    ["2022 launch of the new ledger", "2022 launch of the new ledger"],
    ["Co-led the migration", "Co-led the migration"],
  ])("%j -> %j", (input, expected) => {
    expect(stripBulletMarker(input)).toBe(expected);
  });
});

describe("splitAchievements", () => {
  it.each([
    ["one per line, bullet glyphs", "• Shipped A\n• Cut B by 12%\n• Mentored C", ["Shipped A", "Cut B by 12%", "Mentored C"]],
    ["one per line, hyphens", "- Shipped A\n- Cut B", ["Shipped A", "Cut B"]],
    ["one per line, numbered", "1. Shipped A\n2. Cut B\n3. Mentored C", ["Shipped A", "Cut B", "Mentored C"]],
    ["windows newlines and blank lines", "Shipped A\r\n\r\nCut B\r\n", ["Shipped A", "Cut B"]],
    ["several bullets glued onto ONE line", "• Shipped A • Cut B by 12% • Mentored C", ["Shipped A", "Cut B by 12%", "Mentored C"]],
    ["glyphs on one line AND newlines", "• Shipped A\n• Cut B • Mentored C", ["Shipped A", "Cut B", "Mentored C"]],
    ["plain lines with no markers", "Shipped A\nCut B", ["Shipped A", "Cut B"]],
    ["a single achievement stays one", "Shipped A and cut B by 12%.", ["Shipped A and cut B by 12%."]],
    ["a sentence with a mid-line dash is NOT split", "Cut churn - the biggest in the company - by 12%.", ["Cut churn - the biggest in the company - by 12%."]],
    ["a sentence with a mid-line middle dot is NOT split", "Ran ops · finance · people.", ["Ran ops · finance · people."]],
    ["empty and whitespace", "  \n \n", []],
    ["empty string", "", []],
  ])("%s", (_label, input, expected) => {
    expect(splitAchievements(input)).toEqual(expected);
  });
});

describe("getExperienceBullets / getExperienceText with marker-bearing descriptions", () => {
  const base = { title: "PM", company: "Acme" };

  it("real bullets win and are returned as-is", () => {
    const entry = { ...base, bullets: ["Shipped A", "Cut B"], description: "ignored" };
    expect(getExperienceBullets(entry)).toEqual(["Shipped A", "Cut B"]);
    expect(getExperienceText(entry)).toBe("Shipped A Cut B");
  });

  it("a description that is really a typed list becomes bullets, markers removed", () => {
    const entry = { ...base, description: "- Shipped A\n- Cut B by 12%\n- Mentored C" };
    expect(getExperienceBullets(entry)).toEqual(["Shipped A", "Cut B by 12%", "Mentored C"]);
    // Lockstep with getExperienceBullets: the plain-text read never carries the dashes either.
    expect(getExperienceText(entry)).toBe("Shipped A Cut B by 12% Mentored C");
  });

  it("the same for bullet glyphs and numbering", () => {
    expect(getExperienceBullets({ ...base, description: "• Shipped A\n• Cut B" })).toEqual(["Shipped A", "Cut B"]);
    expect(getExperienceBullets({ ...base, description: "1. Shipped A\n2. Cut B" })).toEqual(["Shipped A", "Cut B"]);
  });

  it("a prose description stays prose", () => {
    const entry = { ...base, description: "Owned the referrals feature end to end." };
    expect(getExperienceBullets(entry)).toBeUndefined();
    expect(getExperienceText(entry)).toBe("Owned the referrals feature end to end.");
  });

  it("a multi-line description WITHOUT markers on every line is not guessed at", () => {
    // Two plain paragraphs are two paragraphs; only an all-markers list is a list.
    const entry = { ...base, description: "Owned the referrals feature.\nAlso ran the tracker." };
    expect(getExperienceBullets(entry)).toBeUndefined();
  });

  it("a single marker line is not a list", () => {
    expect(getExperienceBullets({ ...base, description: "- Owned referrals" })).toBeUndefined();
  });
});
