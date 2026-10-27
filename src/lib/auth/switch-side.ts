"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getOptionalUser } from "@/lib/auth/require-user";
import { isOrganisationMember } from "@/lib/auth/organization-member";
import { SIDE_COOKIE, sideCookieOptions } from "@/lib/auth/side-preference";
import { switchSide } from "@/lib/auth/switch-side-logic";

/**
 * The account menu's "Switch to Employer" / "Switch to Job seeker": remembers the choice in the tr_side cookie and goes to that side's home. The rules are in switch-side-logic.ts; this file only
 * supplies the real session, the real membership lookup, the real cookie jar and the real redirect.
 */
export async function switchSideAction(formData: FormData): Promise<void> {
  await switchSide(formData.get("side"), {
    userId: async () => (await getOptionalUser())?.user.id ?? null,
    isMember: isOrganisationMember,
    setSide: async (side) => {
      (await cookies()).set(SIDE_COOKIE, side, sideCookieOptions(process.env.NODE_ENV === "production"));
    },
    go: (path) => redirect(path),
  });
}
