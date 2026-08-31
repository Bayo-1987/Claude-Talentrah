"use server";

import { requirePermission } from "@/lib/admin/require-admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { findPerson } from "./queries";
import type { PersonLookupState } from "./state";

/**
 * Look one person up, and record that it happened.
 *
 * A SERVER ACTION RATHER THAN A `?q=` PAGE, deliberately. A GET would put the
 * search term — an email address, usually — into the URL, and from there into
 * browser history, the referrer on any outbound link, and any request log that
 * keeps paths. For the dashboard's first PII surface that is a needless second
 * copy of the thing being protected. A POST keeps it in the request body.
 *
 * THE LOOKUP IS LOGGED, AND THAT IS THE POINT OF THIS MILESTONE AS MUCH AS THE
 * SCREEN IS. `admin_audit_log` has until now recorded only actions that CHANGE
 * something. Reading somebody's payment history changes nothing and is still
 * consequential — it is precisely the access that §8's "ownership-restricted"
 * rule exists to constrain, performed by the one role that can bypass it. An
 * operator who can read any customer's financial record without leaving a
 * trace is the gap; the log closes it, and the notice on the screen is what
 * actually changes behaviour.
 *
 * MISSES ARE NOT LOGGED, and that is not laziness. A log of every string typed
 * into this box would accumulate the email addresses of people who are not
 * users — supplied by whoever mistyped them — in exchange for no signal about
 * anything. It is the same call as M1's failed-login logging, which records an
 * attempt only when the address belongs to a real admin.
 */
export async function lookUpPersonAction(
  _prev: PersonLookupState,
  formData: FormData,
): Promise<PersonLookupState> {
  const admin = await requirePermission("people");
  const term = String(formData.get("term") ?? "").trim();

  if (!term) {
    return { status: "idle" };
  }

  let person;
  try {
    person = await findPerson(term);
  } catch (err) {
    console.error("[admin-finance] lookup", err);
    return { status: "error", message: "Something went wrong on our end." };
  }

  if (!person) {
    return {
      status: "not_found",
      message:
        "No match. This searches exact email, user id or Paystack reference — there is no partial matching.",
    };
  }

  await recordAdminAction({
    identity: admin,
    action: "person.viewed",
    targetTable: "profiles",
    targetId: person.id,
    // The person's id is already the target; the SEARCH TERM is not recorded,
    // because on a hit it is just a second copy of an identifier the row
    // already carries, and recording how someone was found is not the same
    // question as recording that they were.
    detail: { matched_by: term.includes("@") ? "email" : /^[0-9a-f-]{36}$/i.test(term) ? "user_id" : "reference" },
  });

  return { status: "found", person };
}
