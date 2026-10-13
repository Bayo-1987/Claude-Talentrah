import { absoluteUrl } from "@/lib/seo/site";
import { buildDigestEmail, type DigestGroup } from "./emails";
import type { Recipient } from "./instant";

export interface DigestRow {
  notificationId: string;
  applicationId: string;
  jobId: string;
  organizationId: string;
  isFirst: boolean;
  /** The first applicant whose instant email already went out: members on 'instant' must not see them again. */
  alreadyAnnounced: boolean;
}

export interface DigestDeps {
  /** claim_applicant_digest (0254): every unsent, non-suppressed notification older than `until`, claimed exactly once (skip locked). */
  claim(until: Date): Promise<DigestRow[]>;
  release(notificationIds: string[]): Promise<void>;
  recipients(organizationId: string): Promise<Recipient[]>;
  names(applicationIds: string[]): Promise<Map<string, string>>;
  jobTitles(jobIds: string[]): Promise<Map<string, string>>;
  send(p: { to: string; subject: string; text: string; html: string }): Promise<boolean>;
}

export interface DigestSummary {
  ok: boolean;
  claimed: number;
  organisations: number;
  emailsSent: number;
  emailsFailed: number;
  released: number;
}

/**
 * The daily digest (07:05Z, 08:05 Nigeria): everything the database recorded since the last run, one email per member per organisation with every job grouped. A member on 'instant' is not told again about the
 * first applicant whose instant email already went out; a member on 'digest' hears about everyone; 'off', QA and deleting members are not recipients at all (new_applicant_recipients). If EVERY email for an
 * organisation fails, that organisation's rows are released so tomorrow's run carries them; if at least one went out they are not (nobody is told twice). Never throws.
 */
export async function runNewApplicantDigest(deps: DigestDeps, now: Date = new Date()): Promise<DigestSummary> {
  const summary: DigestSummary = { ok: true, claimed: 0, organisations: 0, emailsSent: 0, emailsFailed: 0, released: 0 };

  let rows: DigestRow[];
  try {
    rows = await deps.claim(now);
  } catch (error) {
    console.error("[new-applicant-digest] could not claim:", error instanceof Error ? error.message : "unknown error");
    return { ...summary, ok: false };
  }
  summary.claimed = rows.length;
  if (rows.length === 0) return summary;

  const byOrganisation = new Map<string, DigestRow[]>();
  for (const row of rows) byOrganisation.set(row.organizationId, [...(byOrganisation.get(row.organizationId) ?? []), row]);
  summary.organisations = byOrganisation.size;

  for (const [organizationId, orgRows] of byOrganisation) {
    const ids = orgRows.map((r) => r.notificationId);
    try {
      const recipients = await deps.recipients(organizationId);
      if (recipients.length === 0) continue;

      const [names, titles] = await Promise.all([deps.names(orgRows.map((r) => r.applicationId)), deps.jobTitles([...new Set(orgRows.map((r) => r.jobId))])]);

      let sentForOrganisation = 0;
      let attempted = 0;
      for (const recipient of recipients) {
        const relevant = recipient.mode === "instant" ? orgRows.filter((r) => !r.alreadyAnnounced) : orgRows;
        if (relevant.length === 0) continue;

        const groups: DigestGroup[] = [];
        for (const jobId of new Set(relevant.map((r) => r.jobId))) {
          const jobRows = relevant.filter((r) => r.jobId === jobId);
          groups.push({
            jobId,
            jobTitle: titles.get(jobId) ?? "A job",
            count: jobRows.length,
            names: jobRows.map((r) => names.get(r.applicationId)?.trim() || "A new applicant"),
            applicantsUrl: absoluteUrl(`/employer/jobs/${jobId}/applicants`),
          });
        }
        const email = buildDigestEmail({ groups, settingsUrl: absoluteUrl("/employer/jobs") });

        attempted += 1;
        let delivered = false;
        try {
          delivered = await deps.send({ to: recipient.email, subject: email.subject, text: email.text, html: email.html });
        } catch {
          delivered = false;
        }
        if (delivered) {
          summary.emailsSent += 1;
          sentForOrganisation += 1;
        } else {
          summary.emailsFailed += 1;
        }
      }

      if (attempted > 0 && sentForOrganisation === 0) {
        console.error(`[new-applicant-digest] every email failed for organisation ${organizationId}: releasing ${ids.length} notification(s)`);
        await deps.release(ids);
        summary.released += ids.length;
        summary.ok = false;
      }
    } catch (error) {
      console.error(`[new-applicant-digest] organisation ${organizationId} failed:`, error instanceof Error ? error.message : "unknown error");
      await deps.release(ids).catch(() => {});
      summary.released += ids.length;
      summary.ok = false;
    }
  }
  console.log(`[new-applicant-digest] claimed=${summary.claimed} organisations=${summary.organisations} sent=${summary.emailsSent} failed=${summary.emailsFailed} released=${summary.released}`);
  return summary;
}
