/**
 * ACCT-1 PR 1 — the deletion guard covers every sender because there is exactly one way to get a mail client.
 *
 * The guard lives in `getResendClient()` (src/lib/resend/client.ts). It only covers a sender that gets its client there. A file that imported
 * `resend` and built its own `new Resend(key)` would be a sender the guard cannot see, and the first person to learn of it would be a user who
 * asked to be deleted and got an email anyway. So: nothing under src/ except that one file may import the `resend` package, and the file
 * must not export the raw class.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const SRC = join(__dirname, "../../src");
const files = walk(SRC);

describe("the one door to the mail provider", () => {
  it("only src/lib/resend/client.ts imports the `resend` package", () => {
    const offenders = files.filter((f) => {
      if (f.endsWith(join("lib", "resend", "client.ts"))) return false;
      const text = readFileSync(f, "utf8");
      return /from\s+["']resend["']|require\(\s*["']resend["']\s*\)/.test(text);
    });
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });

  it("every `.emails.send(` in src/ is called on a client obtained from getResendClient()", () => {
    const senders = files.filter((f) => /\.emails\.send\(/.test(readFileSync(f, "utf8")));
    expect(senders.length).toBeGreaterThanOrEqual(10);
    const missing = senders.filter((f) => !/getResendClient\(/.test(readFileSync(f, "utf8")));
    expect(missing.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });

  it("the client module does not hand out the raw Resend constructor", () => {
    const text = readFileSync(join(SRC, "lib/resend/client.ts"), "utf8");
    expect(text).not.toMatch(/export\s*\{[^}]*\bResend\b/);
    expect(text).not.toMatch(/export\s+(class|const)\s+Resend\b/);
  });
});

describe("the lifecycle door is as narrow as the allowlist", () => {
  it("only src/lib/account-deletion/ calls sendDeletionLifecycleEmail", () => {
    const callers = files.filter((f) => {
      if (f.endsWith(join("lib", "resend", "client.ts"))) return false;
      return /sendDeletionLifecycleEmail\(/.test(readFileSync(f, "utf8"));
    });
    expect(callers.filter((f) => !f.includes(join("lib", "account-deletion"))).map((f) => f.slice(SRC.length + 1))).toEqual([]);
    expect(callers.length).toBeGreaterThan(0);
  });

  it("every allowlisted template is listed in docs/account-deletion-map.md, and the map lists nothing else", () => {
    const doc = readFileSync(join(__dirname, "../../docs/account-deletion-map.md"), "utf8");
    const section = /## Deletion-lifecycle emails([\s\S]*?)(\n## |$)/.exec(doc);
    expect(section, "the map must have a '## Deletion-lifecycle emails' section").not.toBeNull();
    const listed = [...section![1].matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]).sort();
    const code = readFileSync(join(SRC, "lib/resend/deletion-lifecycle.ts"), "utf8");
    const allowed = [...(/DELETION_LIFECYCLE_TEMPLATES\s*=\s*\[([\s\S]*?)\]/.exec(code)![1].matchAll(/"([a-z_]+)"/g))].map((m) => m[1]).sort();
    expect(listed).toEqual(allowed);
  });
});
