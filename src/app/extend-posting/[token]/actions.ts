"use server";

import { revalidatePath } from "next/cache";
import { redeemExtendToken, type ExtendResult } from "@/lib/jobs/expiry-reminders/extend";

/**
 * The one thing on the Extend page that changes anything. A Server Action is only ever reached by a POST, which is
 * what keeps a GET (a mail scanner, a link previewer) from extending a posting — see the page's own header.
 *
 * The token in the argument is the authorisation; there is no session, by necessity (the person is in their mail
 * client). The atomic, single-use enforcement is in the database function behind redeemExtendToken.
 */
export async function extendPostingAction(token: string): Promise<ExtendResult> {
  const result = await redeemExtendToken(token);

  if (result.outcome === "extended") {
    // The closing date is part of what the public job page and the employer's own list render.
    revalidatePath("/employer/jobs");
    revalidatePath("/jobs");
    revalidatePath(`/jobs/${result.jobId}`);
  }
  return result;
}
