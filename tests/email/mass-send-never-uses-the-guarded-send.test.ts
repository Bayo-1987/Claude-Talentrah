/**
 * The batch path never imports or calls getResendClient's guarded send.
 *
 * `getResendClient()` wraps `emails.send` in a deletion guard; the batch endpoint is not covered by it. The mass-send path therefore does its own filtering
 * (see run-email.ts), and this file keeps the two apart in both directions: the mass-send files never call the single-send method, never import the provider package,
 * and reach the provider only through the batch endpoint; and no file outside the mass-send path imports the mass-send modules except the admin-messages wiring.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../../src");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const files = walk(SRC);
const rel = (f: string) => relative(SRC, f);
/** The comments are English; only code counts. */
const code = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const MASS = files.filter((f) => /lib\/email\/mass-send[^/]*\.ts$/.test(f) || /lib\/notifications\/admin-messages\//.test(f));

describe("the batch path never imports or calls getResendClient's guarded send", () => {
  it("there are mass-send files to check", () => {
    expect(MASS.map(rel).sort()).toEqual(
      expect.arrayContaining([
        "lib/email/mass-send-config.ts",
        "lib/email/mass-send-provider.ts",
        "lib/email/mass-send.ts",
        "lib/notifications/admin-messages/run-email.ts",
      ]),
    );
  });

  it("none of them calls the single-send method", () => {
    expect(MASS.filter((f) => /\.emails\.send\s*\(|emails\s*:\s*\{[^}]*send/.test(code(f))).map(rel)).toEqual([]);
  });

  it("none of them imports the provider package or the deletion-lifecycle sender", () => {
    expect(MASS.filter((f) => /from\s+["']resend["']|sendDeletionLifecycleEmail/.test(code(f))).map(rel)).toEqual([]);
  });

  it("only the provider file obtains the client, and it uses only the batch endpoint and a read call for the quota", () => {
    const users = MASS.filter((f) => /getResendClient/.test(code(f))).map(rel);
    expect(users).toEqual(["lib/email/mass-send-provider.ts"]);
    const provider = code(MASS.find((f) => rel(f) === "lib/email/mass-send-provider.ts")!);
    expect(provider).toMatch(/\.batch\.send\(/);
    expect(provider).not.toMatch(/\.emails\./);
  });

  it("the runner asks the database which recipients are eligible, in the batch path itself", () => {
    const runner = code(MASS.find((f) => rel(f) === "lib/notifications/admin-messages/run-email.ts")!);
    expect(runner).toMatch(/adminEmailEligibleRecipients/);
  });

  it("nothing outside the admin-messages wiring imports the mass-send modules, except the operator's own test send", () => {
    const outsiders = files.filter((f) => !MASS.includes(f) && /from\s+["']@\/lib\/email\/mass-send[^"']*["']/.test(code(f))).map(rel);
    expect(outsiders).toEqual(["app/admin/(protected)/messages/test-send.ts"]);
  });
});
