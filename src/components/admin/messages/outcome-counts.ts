import { ADMIN_RECIPIENT_OUTCOMES, type AdminRecipientOutcome } from "@/lib/notifications/contract";

/** Counts of recipient outcomes per channel. Numbers only: a person is never part of this. */
export type OutcomeCounts = {
  push: Record<AdminRecipientOutcome | "queued", number>;
  email: Record<AdminRecipientOutcome | "queued", number>;
};

export function emptyCounts(): Record<AdminRecipientOutcome | "queued", number> {
  const out = { queued: 0 } as Record<AdminRecipientOutcome | "queued", number>;
  for (const o of ADMIN_RECIPIENT_OUTCOMES) out[o] = 0;
  return out;
}

export function emptyOutcomeCounts(): OutcomeCounts {
  return { push: emptyCounts(), email: emptyCounts() };
}

/** Groups outcome-only rows. The rows carry no identity, so neither can the result. */
export function countOutcomes(rows: ReadonlyArray<{ push_outcome: string | null; email_outcome: string | null; to_push: boolean; to_email: boolean }>): OutcomeCounts {
  const out = emptyOutcomeCounts();
  const bump = (bucket: Record<AdminRecipientOutcome | "queued", number>, outcome: string | null) => {
    const key = (outcome ?? "queued") as AdminRecipientOutcome | "queued";
    if (key in bucket) bucket[key] += 1;
  };
  for (const row of rows) {
    if (row.to_push) bump(out.push, row.push_outcome);
    if (row.to_email) bump(out.email, row.email_outcome);
  }
  return out;
}

export const OUTCOME_LABEL: Record<AdminRecipientOutcome | "queued", string> = {
  queued: "Queued",
  sent: "Sent",
  failed: "Failed",
  skipped_opted_out: "Skipped: opted out",
  skipped_quiet_hours: "Skipped: quiet hours",
  skipped_cap: "Skipped: push cap",
  skipped_deleted: "Skipped: account leaving",
  skipped_inactive: "Skipped: not eligible",
};
