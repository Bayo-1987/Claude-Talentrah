import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { spendCredits, InsufficientCreditsError } from "@/lib/credits/spend";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { TALENT_DIRECTORY_BOOST_DAYS } from "./boost-constants";

/**
 * Talent Directory v2, part 1: the seeker-paid search boost (§6.13's third
 * buyer segment — "job seekers themselves (competitive edge, paid via
 * credits)"). See 0137's own migration header for why a time-boxed boost
 * (this) was chosen over a "Featured" badge or a weighted verification
 * score. The duration itself (TALENT_DIRECTORY_BOOST_DAYS) lives in
 * boost-constants.ts, not here, so boost-panel.tsx's client component can
 * read it without pulling this server-only module into the client bundle.
 */
export { TALENT_DIRECTORY_BOOST_DAYS };

/**
 * Same claim-then-spend shape runTalentVerification (verification-runner.ts)
 * already established: insert a 'pending' audit row FIRST, spend credits
 * through spendCredits' own atomic RPC (0035, unchanged — this only adds a
 * new credit_reason, 0136), then resolve the row and extend the boost in ONE
 * atomic statement (resolve_talent_directory_boost, 0137). A spend failure
 * deletes the still-pending row directly — the service-role client bypasses
 * RLS, and unlike verification's release path, no profiles column has been
 * touched yet at that point, so there's nothing on profiles to compensate.
 *
 * Unlike verification, there is no external LLM call and no mutually
 * exclusive state machine to protect with the claim (a boost purchase is
 * never "already in progress" the way a verification attempt is) — the
 * claim row here exists to give credit_ledger.related_entity_id something
 * to point at and to make the extension idempotent per purchase, not to gate
 * a slow side effect. What genuinely needs its own atomic statement is the
 * EXTENSION itself: see resolve_talent_directory_boost's own comment for why
 * a plain read-then-write of talent_boosted_until would lose an extension
 * under concurrent purchases even though both charges succeeded.
 */
export interface BoostActionResult {
  status: "success" | "error";
  message: string;
  boostedUntil?: string;
}

export async function runTalentDirectoryBoostPurchase(userId: string): Promise<BoostActionResult> {
  const serviceClient = createServiceRoleClient();
  const cost = CREDIT_COSTS.talentDirectoryBoost;
  const days = TALENT_DIRECTORY_BOOST_DAYS;

  const { data: eligible } = await serviceClient
    .from("profiles")
    .select("talent_verification_status, talent_directory_opt_in")
    .eq("id", userId)
    .single();

  // Buying a boost only makes sense for someone who can actually appear in
  // search results — the gate itself lives entirely in talent_directory_search
  // (0135, untouched by 0137) and this check changes nothing about it; it
  // only stops a seeker from spending credits on a boost that could never
  // show them to anyone while they stay unverified or opted out.
  if (eligible?.talent_verification_status !== "verified" || !eligible?.talent_directory_opt_in) {
    return {
      status: "error",
      message: "You need to be verified and listed in the directory before boosting your placement.",
    };
  }

  const { data: boost, error: insertError } = await serviceClient
    .from("talent_directory_boosts")
    .insert({ user_id: userId, days, status: "pending" })
    .select("id")
    .single();

  if (insertError || !boost) {
    return { status: "error", message: "Something went wrong on our end." };
  }

  try {
    await spendCredits(userId, cost, "talent_directory_boost", boost.id);
  } catch (err) {
    await serviceClient.from("talent_directory_boosts").delete().eq("id", boost.id).eq("status", "pending");
    if (err instanceof InsufficientCreditsError) {
      return {
        status: "error",
        message: `Not enough credits — this needs ${cost}, you have ${err.available}.`,
      };
    }
    throw err;
  }

  const { data: boostedUntil, error: resolveError } = await serviceClient.rpc("resolve_talent_directory_boost", {
    p_boost_id: boost.id,
    p_user_id: userId,
    p_days: days,
  });

  if (resolveError || !boostedUntil) {
    // Credits were already spent and the ledger is the source of truth here
    // — same "surfaced rather than silently swallowed" reasoning
    // runTalentVerification uses for its own equivalent branch.
    return {
      status: "error",
      message: "Your credits were charged but we couldn't record the boost — contact support with this time.",
    };
  }

  return {
    status: "success",
    message: `You're now boosted to the top of search results until ${new Date(boostedUntil).toLocaleDateString()}.`,
    boostedUntil,
  };
}
