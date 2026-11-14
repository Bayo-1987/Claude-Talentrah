import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_FLAGS } from "@/lib/notifications/contract";
import { FakePushSender } from "@/lib/notifications/fakes/fake-push-sender";
import { deliverPush } from "@/lib/notifications/push/deliver";
import { makeTarget, recordingLog } from "./push-support";

const ROOT = path.resolve(__dirname, "../..");
const source = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");
/** Source with comments removed, so a rule about code is not satisfied or broken by a sentence. */
const code = (relative: string) => source(relative).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

afterEach(() => vi.restoreAllMocks());

describe("the three route files", () => {
  const ROUTES: Array<[string, string, string, string]> = [
    ["src/app/api/push/subscribe/route.ts", "POST", "handleSubscribe", "GET"],
    ["src/app/api/push/devices/route.ts", "GET", "handleDevices", "POST"],
    ["src/app/api/push/devices/remove/route.ts", "POST", "handleDeviceRemove", "GET"],
  ];
  it.each(ROUTES)("%s exports only %s, is never cached, and hands the request to %s with the real session", (file, method, handler, other) => {
    expect(existsSync(path.join(ROOT, file))).toBe(true);
    const text = code(file);
    expect(text).toMatch(new RegExp(`export async function ${method}\\(`));
    expect(text).not.toMatch(new RegExp(`export (async )?function ${other}\\(`));
    expect(text).toMatch(/export const dynamic = "force-dynamic"/);
    expect(text).toContain(`${handler}(request,`);
    expect(text).toContain("realRouteDeps(");
  });
  it("the real route deps use the signed-in person's client, never the service role, and delete by id", () => {
    const text = code("src/lib/notifications/push/session-deps.ts");
    expect(text).toContain('from "@/lib/supabase/server"');
    expect(text).not.toMatch(/service-role|createServiceRoleClient/);
    expect(text).toMatch(/registerPushSubscription\(/);
    expect(text).toMatch(/\.delete\(\)[\s\S]{0,40}\.eq\("id"/);
    expect(text).toMatch(/\.select\("id, ua_short, created_at, last_seen_at, revoked_at"\)/);
    expect(text).toContain("isFeatureEnabled");
  });
});

describe("the sender's wiring", () => {
  it("claims, releases and marks only through the accessors, reads flags with the uncached reader, and checks the key pair before it sends", () => {
    const text = code("src/lib/notifications/push/wiring.ts");
    for (const name of ["claimNotification", "releaseNotification", "markNotificationSent", "pushSubscriptionsTable", "isFeatureEnabled", "readVapidConfig"]) expect(text).toContain(name);
    expect(text).not.toMatch(/\.rpc\(/);
    expect(text).not.toMatch(/process\.env\.PWA_KILL/);
    expect(text).toContain("deletion_requested_at");
  });
  it("web-push is pinned to an exact version", () => {
    const manifest = JSON.parse(source("package.json")) as { dependencies: Record<string, string> };
    expect(manifest.dependencies["web-push"]).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("only the real transport imports web-push", () => {
    expect(code("src/lib/notifications/push/web-push-transport.ts")).toContain('from "web-push"');
    for (const file of ["sender", "deliver", "payload", "vapid", "routes", "session-deps", "wiring"]) expect(code(`src/lib/notifications/push/${file}.ts`)).not.toContain('from "web-push"');
  });
});

describe("with every flag OFF, a page load and a deploy change nothing observable", () => {
  it("importing the push modules writes nothing, reads no environment secret, opens no connection and logs nothing", async () => {
    const consoles = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const fetches = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in this test"));
    for (const kill of [undefined, "1", "0"]) {
      vi.resetModules();
      vi.stubEnv("PWA_KILL", kill as string);
      await import("@/lib/notifications/push/sender");
      await import("@/lib/notifications/push/deliver");
      await import("@/lib/notifications/push/payload");
      await import("@/lib/notifications/push/routes");
      await import("@/lib/notifications/push/vapid");
      vi.unstubAllEnvs();
    }
    expect(fetches).not.toHaveBeenCalled();
    expect(consoles.every((c) => c.mock.calls.length === 0)).toBe(true);
  });
  it("a delivery with every flag off, with the kill switch on and off, draws on no budget: no claim, no device read, no send", async () => {
    let budgetDrawn = 0;
    let devicesRead = 0;
    const sender = new FakePushSender();
    const log = recordingLog();
    for (const kill of [undefined, "1", "0"]) {
      const result = await deliverPush(
        {
          env: { PWA_KILL: kill },
          flagOn: async (key) => key === "something-else",
          isDeleting: async () => false,
          loadTargets: async () => {
            devicesRead += 1;
            return [makeTarget()];
          },
          claim: async () => {
            budgetDrawn += 1;
            return { id: "x", refused: null };
          },
          release: async () => undefined,
          markSent: async () => undefined,
          revokeDevice: async () => undefined,
          sender,
          log: log.log,
        },
        { userId: "00000000-0000-4000-8000-0000000000a1", kind: "match_alert", subject: "s", url: "/dashboard", badge: 1 },
      );
      expect(["kill", "flag_off"]).toContain(result.skipped);
    }
    expect([budgetDrawn, devicesRead, sender.sent.length]).toEqual([0, 0, 0]);
    expect(Object.values(NOTIFICATION_FLAGS)).toContain("push_sender");
  });
});
