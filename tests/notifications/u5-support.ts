/**
 * Shared test doubles for the U5 event tests: a recording stand-in for the service-role client (every query is logged with its table, operation, filters and payload, and answered by a per-test
 * handler) and a recording mailer. Nothing here is a credential; addresses are example.test.
 */

export type FakeCall = {
  table: string;
  op: "select" | "insert" | "update" | "delete" | "rpc";
  filters: Array<[string, string, unknown]>;
  payload?: unknown;
  columns?: string;
};
export type FakeAnswer = { data?: unknown; error?: { message: string; code?: string } | null };
export type FakeHandler = (call: FakeCall) => FakeAnswer | undefined;

const FILTERS = ["eq", "neq", "in", "is", "gte", "lte", "gt", "lt", "like", "ilike", "order", "limit", "range", "not", "or", "contains"] as const;

export function makeFakeDb(handler: FakeHandler) {
  const calls: FakeCall[] = [];
  const settle = (call: FakeCall, single: boolean) => {
    calls.push(call);
    const answer = handler(call) ?? {};
    let data = answer.data === undefined ? (call.op === "select" ? [] : null) : answer.data;
    if (single && Array.isArray(data)) data = data[0] ?? null;
    return Promise.resolve({ data, error: answer.error ?? null });
  };
  const builder = (table: string, op: FakeCall["op"], payload?: unknown) => {
    const call: FakeCall = { table, op, filters: [], payload };
    const b: Record<string, unknown> = {};
    for (const name of FILTERS) b[name] = (column: string, value?: unknown) => (call.filters.push([name, column, value]), b);
    b.select = (columns?: string) => {
      call.columns = columns;
      return b;
    };
    b.maybeSingle = () => settle(call, true);
    b.single = () => settle(call, true);
    b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => settle(call, false).then(resolve, reject);
    return b;
  };
  const client = {
    from: (table: string) => ({
      select: (columns?: string) => {
        const chain = builder(table, "select");
        (chain.select as (c?: string) => unknown)(columns);
        return chain;
      },
      insert: (payload: unknown) => builder(table, "insert", payload),
      update: (payload: unknown) => builder(table, "update", payload),
      delete: () => builder(table, "delete"),
    }),
    rpc: (name: string, args?: unknown) => builder(name, "rpc", args),
  };
  return { client, calls };
}

export const writesTo = (calls: FakeCall[], table: string) => calls.filter((c) => c.table === table && c.op !== "select");
export const tablesTouched = (calls: FakeCall[]) => [...new Set(calls.map((c) => c.table))];

export function makeMailer() {
  const sent: Array<{ to: string; subject: string }> = [];
  return { sent, resend: { emails: { send: async (payload: { to: string; subject: string }) => (sent.push(payload), { data: { id: "mock" }, error: null }) } } };
}

/* ---- the real delivery step with in-memory dependencies: a claim is refused the second time for the same (person, kind, subject, device), as the database's open-claim key does ---- */
import { deliverPush, type DeliverDeps, type DeliverRequest } from "@/lib/notifications/push/deliver";
import { FakePushSender } from "@/lib/notifications/fakes/fake-push-sender";
import type { ClaimNotificationArgs } from "@/lib/notifications/contract";
import { makeTarget } from "./push-support";

export function makeDeliverHarness(over: { flagsOn?: boolean } = {}) {
  const sender = new FakePushSender();
  const claims: ClaimNotificationArgs[] = [];
  const open = new Set<string>();
  const requests: DeliverRequest[] = [];
  const deps: DeliverDeps = {
    env: {},
    flagOn: async () => over.flagsOn !== false,
    isDeleting: async () => false,
    loadTargets: async () => [makeTarget()],
    claim: async (args) => {
      const key = [args.p_user, args.p_kind, args.p_subject, args.p_channel].join("|");
      if (open.has(key)) return { id: null, refused: "already_claimed" };
      open.add(key);
      claims.push(args);
      return { id: `claim-${claims.length}`, refused: null };
    },
    release: async () => undefined,
    markSent: async () => undefined,
    revokeDevice: async () => undefined,
    sender,
    log: () => undefined,
  };
  return {
    sender,
    claims,
    requests,
    deliver: (request: DeliverRequest) => (requests.push(request), deliverPush(deps, request)),
  };
}
