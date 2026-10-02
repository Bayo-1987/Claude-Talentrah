import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { ScheduledDeletionPrompt } from "@/components/account-deletion/scheduled-deletion-prompt";

export const metadata = { title: "Account scheduled for deletion — Talentrah", robots: { index: false, follow: false } };

/**
 * Where `requireUser()` sends a person whose account is scheduled for deletion (ACCT-1 PR 1): "Your account is scheduled for deletion on <date>.
 * Restore it, or keep the deletion?". Asks for `allowPendingDeletion` because it IS the pending person's page. A person whose account is not scheduled
 * has no business here and goes to the app.
 */
export default async function AccountDeletionPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { profile } = await requireUser({ allowPendingDeletion: true });
  const { error } = await searchParams;

  if (!profile.deletion_requested_at && error !== "window_closed") redirect("/jobs");

  const supabase = await createClient();
  const { data } = await supabase.rpc("account_deletion_status");
  const status = (data ?? {}) as { scheduled?: boolean; hard_delete_after?: string; credits_forfeited?: number };

  return (
    <ScheduledDeletionPrompt
      hardDeleteAfter={status.hard_delete_after ?? null}
      creditsForfeited={status.credits_forfeited ?? 0}
      error={error === "window_closed" || error === "failed" ? error : null}
    />
  );
}
