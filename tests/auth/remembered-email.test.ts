/**
 * The remembered-email helper behind the sign-in page's "Continue as <email>" card (LOGIN-REMEMBERED-ACCOUNT-1).
 *
 * It stores ONE thing, an email address, under ONE key, in localStorage, and the page is only a convenience on top of it. So the
 * contract worth pinning is mostly what it refuses to do: it never throws when storage is blocked, it never hands back a value that is
 * not an email, and it never writes a value that is not an email.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REMEMBERED_EMAIL_KEY,
  authCookieSignature,
  clearRememberedEmail,
  isPlainEmail,
  readRememberedEmail,
  writeRememberedEmail,
} from "@/lib/auth/remembered-email";

/** A working in-memory localStorage; the test environment is node, so there is no real one. */
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
  };
}

/** A storage whose every method throws, the way a browser with storage blocked does. */
function blockedStorage() {
  const boom = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

let storage: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal("localStorage", storage);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the key", () => {
  it("is exactly talentrah.lastEmail, and nothing else is ever written", () => {
    expect(REMEMBERED_EMAIL_KEY).toBe("talentrah.lastEmail");
    writeRememberedEmail("ada@example.com");
    expect([...storage.data.keys()]).toEqual(["talentrah.lastEmail"]);
  });
});

describe("read", () => {
  it("returns null when nothing is stored", () => {
    expect(readRememberedEmail()).toBeNull();
  });

  it("round-trips a valid email", () => {
    writeRememberedEmail("ada@example.com");
    expect(readRememberedEmail()).toBe("ada@example.com");
  });

  it("round-trips a plus-addressed email and trims surrounding space on the way in", () => {
    writeRememberedEmail("  ada+work@mail.example.co.uk  ");
    expect(readRememberedEmail()).toBe("ada+work@mail.example.co.uk");
  });

  it.each([
    ["empty string", ""],
    ["plain text", "not an email"],
    ["no domain dot", "ada@localhost"],
    ["two at signs", "a@b@example.com"],
    ["script tag", "<script>alert(1)</script>"],
    ["script tag that looks like an address", "<script>alert(1)</script>@example.com"],
    ["an attribute breakout", 'a"onmouseover="alert(1)@example.com'],
    ["an entity", "a&lt;b@example.com"],
    ["javascript: url", "javascript:alert(1)//@example.com"],
    ["internal whitespace", "ada lovelace@example.com"],
    ["a newline", "ada@example.com\nbcc@example.com"],
    ["a json object", '{"email":"ada@example.com"}'],
    ["an enormous string", `${"a".repeat(300)}@example.com`],
  ])("returns null for stored garbage (%s)", (_name, value) => {
    storage.setItem(REMEMBERED_EMAIL_KEY, value);
    expect(readRememberedEmail()).toBeNull();
  });
});

describe("write", () => {
  it("refuses a value that is not an email, and leaves what was there alone", () => {
    writeRememberedEmail("ada@example.com");
    writeRememberedEmail("<script>alert(1)</script>");
    writeRememberedEmail("");
    expect(readRememberedEmail()).toBe("ada@example.com");
  });
});

describe("clear", () => {
  it("removes the remembered email", () => {
    writeRememberedEmail("ada@example.com");
    clearRememberedEmail();
    expect(readRememberedEmail()).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it("is a no-op when nothing is stored", () => {
    expect(() => clearRememberedEmail()).not.toThrow();
  });
});

describe("storage that throws", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", blockedStorage());
  });

  it("read returns null and never throws", () => {
    expect(() => readRememberedEmail()).not.toThrow();
    expect(readRememberedEmail()).toBeNull();
  });

  it("write and clear never throw", () => {
    expect(() => writeRememberedEmail("ada@example.com")).not.toThrow();
    expect(() => clearRememberedEmail()).not.toThrow();
  });
});

describe("no storage at all", () => {
  it("behaves as if nothing is stored (accessing localStorage itself can throw)", () => {
    vi.unstubAllGlobals();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    try {
      expect(readRememberedEmail()).toBeNull();
      expect(() => writeRememberedEmail("ada@example.com")).not.toThrow();
      expect(() => clearRememberedEmail()).not.toThrow();
    } finally {
      // @ts-expect-error restoring the node default (no localStorage property)
      delete globalThis.localStorage;
    }
  });
});

describe("isPlainEmail", () => {
  it("accepts ordinary addresses and rejects everything that is not a string", () => {
    expect(isPlainEmail("ada@example.com")).toBe(true);
    expect(isPlainEmail(null)).toBe(false);
    expect(isPlainEmail(undefined)).toBe(false);
    expect(isPlainEmail(42)).toBe(false);
    expect(isPlainEmail({})).toBe(false);
  });
});

describe("authCookieSignature", () => {
  it("is empty when there are no cookies or none are Supabase auth cookies", () => {
    expect(authCookieSignature("")).toBe("");
    expect(authCookieSignature("theme=dark; consent=1")).toBe("");
  });

  it("changes when the auth cookie appears, and when it is replaced", () => {
    const before = authCookieSignature("theme=dark");
    const after = authCookieSignature("theme=dark; sb-abc-auth-token=base64-AAA");
    const refreshed = authCookieSignature("theme=dark; sb-abc-auth-token=base64-BBB");
    expect(after).not.toBe(before);
    expect(refreshed).not.toBe(after);
  });

  it("covers a chunked cookie, and ignores unrelated cookies changing", () => {
    const a = authCookieSignature("sb-abc-auth-token.0=aaa; sb-abc-auth-token.1=bbb; x=1");
    expect(a).toContain("sb-abc-auth-token.0=aaa");
    expect(a).toContain("sb-abc-auth-token.1=bbb");
    expect(authCookieSignature("sb-abc-auth-token.0=aaa; sb-abc-auth-token.1=bbb; x=2")).toBe(a);
  });

  it("never throws when there is no document", () => {
    expect(() => authCookieSignature()).not.toThrow();
    expect(authCookieSignature()).toBe("");
  });
});
