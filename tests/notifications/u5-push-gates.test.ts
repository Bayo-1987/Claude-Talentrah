import { describe, expect, it } from "vitest";
import { NOTIFICATION_FLAGS } from "@/lib/notifications/contract";
import { pushIfAllowed, type PushGateDeps } from "@/lib/notifications/new-applicant/push-gates";
import { makeDeliverHarness } from "./u5-support";

const USER = "00000000-0000-4000-8000-0000000000a1";
const SUBJECT = "00000000-0000-4000-8000-0000000000b1";

function gates(over: { flags?: Record<string, boolean>; prefs?: Record<string, boolean> | null; flagThrows?: boolean } = {}) {
  const delivered: unknown[] = [];
  const order: string[] = [];
  const flags = over.flags ?? { [NOTIFICATION_FLAGS.master]: true, [NOTIFICATION_FLAGS.pushSender]: true };
  const deps: PushGateDeps = {
    flagOn: async (key) => {
      order.push(`flag:${key}`);
      if (over.flagThrows) throw new Error("flag store down");
      return flags[key] === true;
    },
    prefs: async () => {
      order.push("prefs");
      return over.prefs === undefined ? { push_enabled: true, push_new_applicant: true, push_application_viewed: true, push_match_alert: true } : over.prefs;
    },
    deliver: async (request) => {
      order.push("deliver");
      delivered.push(request);
    },
  };
  return { deps, delivered, order };
}
const input = (kind: "new_applicant" | "application_viewed" | "match_alert" = "new_applicant") => ({ userId: USER, kind, subject: SUBJECT, url: "/dashboard" });

describe("the gates in front of every event push", () => {
  it("everything on: delivers once, with the kind, the subject and a null badge", async () => {
    const g = gates();
    expect(await pushIfAllowed(g.deps, input())).toBe("attempted");
    expect(g.delivered).toEqual([{ userId: USER, kind: "new_applicant", subject: SUBJECT, url: "/dashboard", badge: null }]);
  });
  it("delivery is the LAST step: the flags and the person's switches are all read before it", async () => {
    const g = gates();
    await pushIfAllowed(g.deps, input());
    expect(g.order[g.order.length - 1]).toBe("deliver");
    expect(g.order.filter((s) => s === "deliver")).toHaveLength(1);
    expect(g.order.indexOf("prefs")).toBeLessThan(g.order.indexOf("deliver"));
  });
  it.each([
    ["every flag off", { flags: {} }],
    ["notifications_master off", { flags: { [NOTIFICATION_FLAGS.master]: false, [NOTIFICATION_FLAGS.pushSender]: true } }],
    ["push_sender off", { flags: { [NOTIFICATION_FLAGS.master]: true, [NOTIFICATION_FLAGS.pushSender]: false } }],
  ])("with %s nothing is delivered and the person's switches are not even read", async (_name, over) => {
    const g = gates(over);
    expect(await pushIfAllowed(g.deps, input())).toBe("flags_off");
    expect(g.delivered).toHaveLength(0);
    expect(g.order).not.toContain("prefs");
  });
  it("an unreadable flag means off", async () => {
    const g = gates({ flagThrows: true });
    expect(await pushIfAllowed(g.deps, input())).toBe("flags_off");
    expect(g.delivered).toHaveLength(0);
  });
  it.each([
    ["no preference row at all", null],
    ["push_enabled off", { push_enabled: false, push_new_applicant: true, push_application_viewed: true, push_match_alert: true }],
    ["the event's own switch off (push_new_applicant)", { push_enabled: true, push_new_applicant: false, push_application_viewed: true, push_match_alert: true }],
    ["a switch that is missing from the row", { push_enabled: true }],
  ])("%s: nothing is delivered", async (_name, prefs) => {
    const g = gates({ prefs });
    expect(await pushIfAllowed(g.deps, input("new_applicant"))).toBe("switch_off");
    expect(g.delivered).toHaveLength(0);
  });
  it("each kind reads its OWN switch", async () => {
    for (const [kind, column] of [["new_applicant", "push_new_applicant"], ["application_viewed", "push_application_viewed"], ["match_alert", "push_match_alert"]] as const) {
      const only = gates({ prefs: { push_enabled: true, [column]: true } });
      expect(await pushIfAllowed(only.deps, input(kind))).toBe("attempted");
      const others = gates({ prefs: { push_enabled: true, push_new_applicant: kind !== "new_applicant", push_application_viewed: kind !== "application_viewed", push_match_alert: kind !== "match_alert" } });
      expect(await pushIfAllowed(others.deps, input(kind))).toBe("switch_off");
    }
  });
  it("a delivery that throws is swallowed", async () => {
    const g = gates();
    g.deps.deliver = async () => {
      throw new Error("sender exploded");
    };
    await expect(pushIfAllowed(g.deps, input())).resolves.toBe("error");
  });
  it("the push text is generic for all three kinds: no digit, no percent, no name, title, company, score or status word", async () => {
    const h = makeDeliverHarness();
    for (const kind of ["new_applicant", "application_viewed", "match_alert"] as const) await h.deliver({ userId: `${USER}-${kind}`, kind, subject: SUBJECT, url: "/dashboard", badge: null });
    expect(h.sender.sent).toHaveLength(3);
    for (const { payload } of h.sender.sent) {
      expect(`${payload.title} ${payload.body}`).not.toMatch(/\d|%|excellent|good|fair|viewed|applied|interview|offer|rejected|hired|match(ed)? score/i);
    }
  });
});
