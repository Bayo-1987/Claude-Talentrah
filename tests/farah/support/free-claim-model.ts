/**
 * An in-memory model of the three database functions behind the free-message claim (migration 0236), for the tests that run without a database. It mirrors the SQL rule by rule:
 *
 *   claim_farah_free_message(p_user_id, p_allowance, p_window_days, p_hold_seconds)
 *        sweeps this user's expired claims, then counts committed free messages (credit_gate_events rows, reason farah_chat_message, outcome covered_by_free_allowance, inside the window)
 *        PLUS unexpired pending claims, and only if that count is below the allowance records a pending claim: one row {ok, claim_id, used}.
 *   commit_farah_free_claim(p_claim_id, p_user_id, p_credits_available)
 *        turns an UNEXPIRED claim of that user into the committed event, in one step (true), or says false (unknown, someone else's, or expired: an expired one is removed).
 *   release_farah_free_claim(p_claim_id, p_user_id)
 *        removes that user's claim (true) or says false.
 *
 * Each call runs in ONE synchronous step, which is what the database's per-user lock plus single statements give: nothing can interleave inside a call. The real behaviour is proved by the
 * database tests (tests/farah/free-claim.test.ts, CI only) and by tests/farah/free-claim-race-detection.test.ts, which shows the shared assertions can fail on a model that is not atomic.
 */
export type Row = Record<string, unknown>;
export interface ClaimStore {
  credit_gate_events?: Row[];
  farah_free_claims?: Row[];
  [table: string]: Row[] | undefined;
}
const DAY_MS = 86_400_000;
let seq = 0;
const claims = (s: ClaimStore) => (s.farah_free_claims ??= []);
const events = (s: ClaimStore) => (s.credit_gate_events ??= []);

export function freeClaimRpc(store: ClaimStore, fn: string, args: Record<string, unknown>, nowMs: number = Date.now()): { data: unknown; error: { message: string; code?: string } | null } {
  const user = args.p_user_id as string;
  if (fn === "claim_farah_free_message") {
    const allowance = args.p_allowance as number;
    const windowDays = args.p_window_days as number;
    const hold = args.p_hold_seconds as number;
    store.farah_free_claims = claims(store).filter((c) => !(c.user_id === user && (c.expires_at as number) <= nowMs));
    const since = nowMs - windowDays * DAY_MS;
    const committed = events(store).filter(
      (e) => e.user_id === user && e.reason === "farah_chat_message" && e.outcome === "covered_by_free_allowance" && new Date(String(e.created_at)).getTime() >= since,
    ).length;
    const pending = claims(store).filter((c) => c.user_id === user && (c.expires_at as number) > nowMs).length;
    const used = committed + pending;
    if (used < allowance) {
      const id = `claim-${(seq += 1)}`;
      claims(store).push({ id, user_id: user, expires_at: nowMs + hold * 1000 });
      return { data: [{ ok: true, claim_id: id, used: used + 1 }], error: null };
    }
    return { data: [{ ok: false, claim_id: null, used }], error: null };
  }
  if (fn === "commit_farah_free_claim") {
    const id = args.p_claim_id as string;
    const mine = claims(store).find((c) => c.id === id && c.user_id === user);
    if (!mine) return { data: false, error: null };
    store.farah_free_claims = claims(store).filter((c) => c !== mine);
    if ((mine.expires_at as number) <= nowMs) return { data: false, error: null };
    events(store).push({ user_id: user, reason: "farah_chat_message", outcome: "covered_by_free_allowance", credits_required: 0, credits_available: args.p_credits_available, created_at: new Date(nowMs).toISOString() });
    return { data: true, error: null };
  }
  if (fn === "release_farah_free_claim") {
    const id = args.p_claim_id as string;
    const before = claims(store).length;
    store.farah_free_claims = claims(store).filter((c) => !(c.id === id && c.user_id === user));
    return { data: claims(store).length < before, error: null };
  }
  return { data: null, error: { message: `unknown function ${fn}`, code: "PGRST202" } };
}
