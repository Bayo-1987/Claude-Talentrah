import type { AssessmentResponseResult } from "@/lib/employer/assessment-response";
import { formatDateTime } from "@/lib/format/datetime";

type Shown = Extract<AssessmentResponseResult, { status: "ok" }>;

/**
 * An applicant's assessment response, in the page. Pure and server-renderable: no data access, no client state.
 *
 * THE WRITTEN ANSWER IS PLAIN TEXT. It is a React text child (escaped by React: `<script>` and `<b>` print as characters), never `dangerouslySetInnerHTML`, never markdown. `whitespace-pre-wrap` keeps the
 * candidate's line breaks and `break-words` + `min-w-0` make even a 5,000-character unbroken string wrap inside the page (no sideways scrolling at 320 px).
 *
 * THE RESPONSE LINK is clickable only when it starts with http:// or https:// and parses as a web address. Anything else (javascript:, data:, a bare word) is shown as plain text, never as a link; an empty value shows nothing.
 * Every link that leaves the page opens in a new tab with rel="noopener noreferrer".
 *
 * WHERE THE LINK GOES is shown beside the control (ASSESSMENT-LINK-HOST-1), so an employer can see the destination before clicking: the address's HOSTNAME and nothing else. Never the
 * full address: its query can carry a token, its userinfo a password, and its path is the candidate's business. See `responseLinkHost`.
 */
const REL = "noopener noreferrer";

/** The address when it is a real http(s) one, else null. Starting text AND parsing both have to agree, so `https:evil`, `javascript:` and `data:` are all refused. */
export function clickableResponseLink(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** Shown in place of the host when the address cannot be read. */
export const LINK_HOST_FALLBACK = "link address could not be read";

/**
 * The hostname of a response link, or null. ONLY for an address the page would make clickable (`clickableResponseLink`: http or https), so a javascript:, data: or ftp: address never
 * produces a host, even though the URL parser reports a hostname for `javascript://example.test/...`. The URL parser lower-cases the host and gives an internationalised one as punycode
 * (`xn--...`), which is shown as it is so a look-alike domain reads as the different name it is. Hostname only: no port, no user:password, no path, no query, no fragment.
 */
export function responseLinkHost(raw: string | null | undefined): string | null {
  const safe = clickableResponseLink(raw);
  if (!safe) return null;
  try {
    return new URL(safe).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** The host, or the plain fallback sentence when it cannot be read. */
export function linkHostLabel(raw: string | null | undefined): string {
  return responseLinkHost(raw) ?? LINK_HOST_FALLBACK;
}

export function AssessmentResponseView({ applicantName, jobTitle, submission }: { applicantName: string; jobTitle: string; submission: Shown["submission"] }) {
  const { responseText, responseLink, responseFiles, submittedAt } = submission;
  const safeLink = clickableResponseLink(responseLink);
  const linkHost = responseLinkHost(safeLink);
  const plainLink = !safeLink && responseLink && responseLink.trim() ? responseLink.trim() : null;
  const empty = !responseText && responseFiles.length === 0 && !safeLink && !plainLink;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <p className="font-body text-[14.5px] font-semibold text-ink">{applicantName}</p>
        <p className="mt-0.5 font-body text-[12.5px] text-ink-soft">
          {jobTitle} · Submitted {formatDateTime(submittedAt)}
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-3 border-[1.5px] border-ink bg-card p-4">
        {responseText && <p data-testid="assessment-answer" className="min-w-0 font-body text-[14px] leading-[1.6] break-words whitespace-pre-wrap text-ink">{responseText}</p>}
        {responseFiles.length > 0 && (
          <div className="flex min-w-0 flex-col gap-1">
            {responseFiles.map((file, index) =>
              file.url ? (
                <a
                  key={`${file.originalFilename}-${index}`}
                  href={file.url}
                  target="_blank"
                  rel={REL}
                  className="w-fit max-w-full font-body text-[13px] font-semibold break-words text-ink underline underline-offset-2 hover:text-rust"
                >
                  View response file: {file.originalFilename}
                </a>
              ) : (
                <p key={`${file.originalFilename}-${index}`} className="font-body text-[13px] break-words text-rust">
                  {file.originalFilename} — couldn&apos;t generate a link, try refreshing.
                </p>
              ),
            )}
          </div>
        )}
        {safeLink && (
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <a href={safeLink} target="_blank" rel={REL} className="w-fit max-w-full font-body text-[13px] font-semibold break-words text-ink underline underline-offset-2 hover:text-rust">
              Open response link
            </a>
            <span data-testid="assessment-link-host" translate="no" className="min-w-0 font-body text-[12.5px] break-all text-ink-soft">
              {linkHost ? `Goes to ${linkHost}` : `${LINK_HOST_FALLBACK.charAt(0).toUpperCase()}${LINK_HOST_FALLBACK.slice(1)}`}
            </span>
          </div>
        )}
        {plainLink && (
          <p data-testid="assessment-plain-link" className="min-w-0 font-body text-[13px] break-words text-ink-soft">
            Response link (not a web address, so it is not clickable): {plainLink}
          </p>
        )}
        {empty && <p className="font-body text-[13px] text-ink-soft">Empty response.</p>}
      </div>
    </div>
  );
}
