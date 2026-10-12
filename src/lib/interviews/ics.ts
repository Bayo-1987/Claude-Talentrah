/**
 * A calendar file (RFC 5545) for one interview. Times are UTC (the trailing Z), so each person's own calendar shows the interview in their own zone, before and after a clock change. Text values are
 * escaped, and every line is folded at 75 octets without splitting a multi-byte character.
 */
export interface IcsInput {
  uid: string;
  startsAtIso: string;
  durationMinutes: number;
  summary: string;
  description?: string;
  location?: string;
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
/**
 * Free text (the employer's note) goes into a content line, so it must not be able to end that line. Every line break, including a lone carriage return, becomes the escaped \n; a tab becomes a space;
 * any other control character (and the Unicode line and paragraph separators) is dropped. Backslash is escaped first, so the backslashes added for ; and , are not escaped again.
 */
const escapeText = (value: string) =>
  value
    .split(/\r\n|\r|\n/)
    .map((part) =>
      part
        .replace(/\t/g, " ")
        .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, "")
        .replace(/\\/g, "\\\\")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,"),
    )
    .join("\\n");

function fold(line: string): string[] {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return [line];
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = " ";
      bytes = 1;
      limit = 75;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts;
}

export function buildIcs({ uid, startsAtIso, durationMinutes, summary, description, location }: IcsInput): string {
  const start = new Date(startsAtIso);
  if (Number.isNaN(start.getTime())) throw new Error("buildIcs: the start is not a valid time");
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Talentrah//Interviews//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${escapeText(summary)}`,
    ...(description ? [`DESCRIPTION:${escapeText(description)}`] : []),
    ...(location ? [`LOCATION:${escapeText(location)}`] : []),
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.flatMap(fold).join("\r\n") + "\r\n";
}
