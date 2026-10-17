import { EXCLUDED_TABLES, EXPORT_MANIFEST } from "./manifest";
import { selectColumns } from "./shape";

/**
 * The README that opens the file (key `_readme`). Said in plain words, because this is the one place a person learns what the file is and is not.
 * Copy that carries an owner decision is a constant here so a test can pin it by name: the bank-details line is the owner's (6 Oct 2026).
 */

export const BANK_DETAILS_LINE =
  "Bank and payout details are shown masked: the bank name and the last four digits of the account number only. Full details are available on a verified request to support.";

export const OTHER_PEOPLE_LINE =
  "This file holds what you gave us and what is about you. Other people appear only as a role (for example “the mentor”) or a first name, never with contact details, and what other people wrote about or around you, such as a mentor's private notes, a reviewer's notes or an employer's message, is not included.";

export const SECRETS_LINE = "Card authorisations, renewal references, payment-provider references, confirmation and unsubscribe tokens are never included.";

export const RESUME_PDF_LINE =
  "Resumes are in this file as structured data. To get a resume as a PDF, open it in the Resume Builder and use Print, then Save as PDF.";

export const FILES_LINE =
  "Files you uploaded (for example employer exercise submissions) are not in this file yet. Ask support and we will send them to you.";

export interface ReadmeParams {
  generatedAt: Date;
  /** Where support can be reached, as a full address. */
  supportUrl: string;
}

export function buildReadme({ generatedAt, supportUrl }: ReadmeParams): string {
  const tables = EXPORT_MANIFEST.filter((t) => selectColumns(t).length > 0).map((t) => t.table);
  return [
    "Your Talentrah data",
    `Generated ${generatedAt.toISOString()}.`,
    "",
    "What is in it: one list per table, with the rows that belong to you, in the order they were created. Column names are the ones the product uses.",
    `Tables: ${tables.join(", ")}.`,
    "",
    OTHER_PEOPLE_LINE,
    BANK_DETAILS_LINE,
    SECRETS_LINE,
    RESUME_PDF_LINE,
    FILES_LINE,
    "",
    `Organisation records (${Object.keys(EXCLUDED_TABLES).filter((t) => t !== "auth.*").join(", ")}) belong to the organisation or to staff, so they are not part of your file.`,
    `Questions, or a request for something this file does not hold: ${supportUrl}`,
  ].join("\n");
}
