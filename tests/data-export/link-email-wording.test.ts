/**
 * The deletion sentence in the data export link email (DATA-EXPORT-SWEEP-RELIABILITY-1, wording approved by the owner on 20 Oct 2026). It promises only what the system guarantees: the link
 * stops working at the end time (the claim checks it), our copy is deleted after a download, and an unused file is removed afterwards, with no time promised.
 * No database needed.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildLinkEmail } from "@/lib/data-export/email";

const link = `https://www.example.test/data-export/${randomUUID()}`;
const mail = buildLinkEmail({ firstName: "Ada", link, expiresAt: new Date("2026-10-22T09:30:00Z"), supportUrl: "https://www.example.test/contact" });

const NEW_SENTENCE = "After you download it, we delete our copy. If you do not, the link stops working at that time and we remove the file afterwards.";
const OLD_SENTENCE = "The file is deleted as soon as you have downloaded it, or when the link expires.";
const PREFIX = "Open the link below while you are signed in to your Talentrah account, then press Download. It works once, only for this account, and until 2026-10-22 09:30 UTC.";

describe("the link email's deletion sentence", () => {
  it("is the approved text, in the plain text and in the html", () => {
    expect(mail.text).toContain(NEW_SENTENCE);
    expect(mail.html).toContain(NEW_SENTENCE);
  });

  it("the old sentence is gone, in both", () => {
    expect(mail.text).not.toContain(OLD_SENTENCE);
    expect(mail.html).not.toContain(OLD_SENTENCE);
    expect(mail.text).not.toMatch(/as soon as/i);
    expect(mail.text).not.toMatch(/when the link expires/i);
  });

  it("comes straight after the unchanged first part of the sentence, and the rest of the email is as before", () => {
    expect(mail.text).toContain(`${PREFIX} ${NEW_SENTENCE}`);
    expect(mail.text).toContain("If you did not ask for this, ignore this email and contact us: https://www.example.test/contact");
    expect(mail.text).toContain(link);
    expect(mail.html).toContain(link);
    expect(mail.subject).toBe("Your copy of your Talentrah data is ready");
  });

  it("promises no time: no hours, minutes or days after the expiry", () => {
    const after = mail.text.slice(mail.text.indexOf(NEW_SENTENCE));
    expect(after).not.toMatch(/\b(\d+|one|two|few|several)\s+(hours?|minutes?|days?)\b/i);
    expect(after).not.toMatch(/within/i);
  });
});
