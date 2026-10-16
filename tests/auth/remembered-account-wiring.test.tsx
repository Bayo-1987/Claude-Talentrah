/**
 * The remembered-account card's WIRING inside LoginForm (LOGIN-REMEMBERED-ACCOUNT-1, fix list).
 *
 * The helper has its own tests (remembered-email.test.ts) and the card is a plain component; what had no unit test is what LoginForm DOES with them:
 *  - the handler it gives the card's "Use another account" link. If that stopped calling clearRememberedEmail nothing would notice until the next visit (the form
 *    still appears, because the view flips locally, and the card would come back on reload, un-dismissable);
 *  - when it remembers an email at all. Merely leaving the page, or a failed sign-in, must never write one; only a form that goes away with its submit unanswered AND
 *    a changed Supabase auth cookie counts as a successful sign-in. (e2e cannot pin the "leaves mid-flight" half: Next queues a client navigation behind a pending
 *    server action, so the form cannot be made to unmount while the action is held.)
 *
 * This drives the REAL LoginForm through a minimal hook harness (this repo has no DOM or component-test library): React's hooks become slots that live across
 * renders, `render()` runs the component again, effects are captured and run by the test (`mount()` / `unmount()`), the card is expanded by calling it and every
 * other component is read by its props. Only the edges are faked: localStorage, document, FormData and the sign-in action.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: { n: 0 },
  dirty: { v: false },
  effects: [] as Array<() => void | (() => void)>,
  result: { current: null as null | { error: string | null } },
}));

vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  const slot = <T,>(init: () => T): [T, number] => {
    const i = h.cursor.n++;
    if (!(i in h.slots)) h.slots[i] = init();
    return [h.slots[i] as T, i];
  };
  return {
    ...real,
    useState: <T,>(init: T | (() => T)) => {
      const [v, i] = slot(() => (typeof init === "function" ? (init as () => T)() : init));
      return [v, (next: T | ((p: T) => T)) => { h.slots[i] = typeof next === "function" ? (next as (p: T) => T)(h.slots[i] as T) : next; h.dirty.v = true; }];
    },
    useRef: <T,>(init: T) => slot(() => ({ current: init }))[0],
    useEffect: (fn: () => void | (() => void)) => void h.effects.push(fn),
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
    useActionState: (_action: unknown, initial: { error: string | null }) => [h.result.current ?? initial, () => undefined, false],
  };
});
vi.mock("@/lib/auth/actions", () => ({ signInAction: vi.fn() }));
vi.mock("@/lib/auth/remembered-email", async (orig) => {
  const real = await orig<typeof import("@/lib/auth/remembered-email")>();
  return { ...real, clearRememberedEmail: vi.fn(real.clearRememberedEmail) };
});

import { LoginForm } from "@/components/auth/login-form";
import { RememberedAccountCard } from "@/components/auth/remembered-account-card";
import { REMEMBERED_EMAIL_KEY, clearRememberedEmail } from "@/lib/auth/remembered-email";

type El = { type: unknown; props: Record<string, unknown> };
const isEl = (n: unknown): n is El => typeof n === "object" && n !== null && "type" in n && "props" in n;

function render(): unknown {
  h.cursor.n = 0;
  h.dirty.v = false;
  h.effects.length = 0;
  return LoginForm({});
}
/** Expand the card (a plain function component); leave everything else as elements. */
function expand(n: unknown): unknown {
  if (isEl(n) && n.type === RememberedAccountCard) return (n.type as (p: unknown) => unknown)(n.props);
  return n;
}
function find(node: unknown, pred: (e: El) => boolean, out: El[] = []): El[] {
  if (Array.isArray(node)) node.forEach((c) => find(c, pred, out));
  else if (isEl(node)) {
    if (pred(node)) out.push(node);
    find(node.props.children, pred, out);
  }
  return out;
}
const textOf = (n: unknown): string => (Array.isArray(n) ? n.map(textOf).join("") : isEl(n) ? textOf(n.props.children) : typeof n === "string" ? n : "");
const button = (root: unknown, label: RegExp) => find(root, (e) => e.type === "button" && label.test(textOf(e)))[0];

let stored: Map<string, string>;
let doc: { cookie: string };
let typed: string;

/** Run the effects captured by the last render (as React does after commit) and return their cleanups. */
function mount(): Array<() => void> {
  const cleanups: Array<() => void> = [];
  for (const fn of [...h.effects]) {
    const c = fn();
    if (typeof c === "function") cleanups.push(c);
  }
  return cleanups;
}
const unmount = (cleanups: Array<() => void>) => cleanups.forEach((c) => c());

beforeEach(() => {
  h.slots.length = 0;
  h.effects.length = 0;
  h.result.current = null;
  stored = new Map([[REMEMBERED_EMAIL_KEY, "ada@example.com"]]);
  doc = { cookie: "theme=dark" };
  typed = "";
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, v),
    removeItem: (k: string) => void stored.delete(k),
  });
  vi.stubGlobal("document", Object.defineProperties({ addEventListener: () => undefined, removeEventListener: () => undefined, getElementById: () => null }, { cookie: { get: () => doc.cookie } }));
  vi.stubGlobal("FormData", class { get(k: string) { return k === "email" ? typed : null; } });
  vi.mocked(clearRememberedEmail).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("LoginForm with a remembered email", () => {
  it("starts on the card, not the form", () => {
    const root = expand(render());
    expect(button(root, /continue as/i), "no Continue-as button").toBeTruthy();
    expect(textOf(root)).toContain("ada@example.com");
    expect(find(root, (e) => e.type === "form")).toHaveLength(0);
  });

  it("'Use another account' clears the remembered email and shows the ordinary, empty form", () => {
    const card = expand(render());
    (button(card, /use another account/i).props.onClick as () => void)();

    expect(clearRememberedEmail, "the handler did not call clearRememberedEmail").toHaveBeenCalledTimes(1);
    expect(stored.has(REMEMBERED_EMAIL_KEY), "the email is still stored").toBe(false);

    expect(h.dirty.v, "the click did not change what is shown").toBe(true);
    const after = render();
    expect(find(after, (e) => e.type === "form"), "no form after the click").toHaveLength(1);
    expect(find(after, (e) => e.props.name === "email")[0].props.value, "the Email field is not empty").toBe("");
    expect(textOf(after)).not.toContain("Continue as");
  });

  it("tapping the card keeps the email stored, shows the form, and fills the Email field", () => {
    const card = expand(render());
    (button(card, /continue as/i).props.onClick as () => void)();

    expect(clearRememberedEmail).not.toHaveBeenCalled();
    expect(stored.get(REMEMBERED_EMAIL_KEY)).toBe("ada@example.com");
    const after = render();
    expect(find(after, (e) => e.type === "form")).toHaveLength(1);
    expect(find(after, (e) => e.props.name === "email")[0].props.value).toBe("ada@example.com");
  });
});

describe("LoginForm with nothing remembered", () => {
  beforeEach(() => stored.clear());

  it("is the ordinary form, with no card", () => {
    const root = render();
    expect(find(root, (e) => e.type === "form")).toHaveLength(1);
    expect(textOf(root)).not.toMatch(/continue as|use another account/i);
  });

  /** Submit the form the way the browser would, with `email` typed into it. */
  function submit(email: string) {
    typed = email;
    const form = find(render(), (e) => e.type === "form")[0];
    (form.props.onSubmit as (e: unknown) => void)({ currentTarget: {} });
  }

  it("remembers the email when the form goes away with its submit unanswered and the auth cookie has appeared", () => {
    let cleanups = mount();
    doc.cookie = "theme=dark";
    submit("grace@example.com");
    doc.cookie = "theme=dark; sb-abc-auth-token=base64-AAA"; // the server set a session while the form waited
    cleanups = [...cleanups, ...mount()];
    unmount(cleanups);
    expect(stored.get(REMEMBERED_EMAIL_KEY)).toBe("grace@example.com");
  });

  it("writes nothing when the form goes away mid-flight and no session was set (the person just left)", () => {
    const cleanups = mount();
    submit("grace@example.com");
    unmount([...cleanups, ...mount()]);
    expect(stored.has(REMEMBERED_EMAIL_KEY)).toBe(false);
  });

  it("writes nothing when the auth cookie was already there and did not change", () => {
    doc.cookie = "sb-abc-auth-token=base64-STALE";
    const cleanups = mount();
    submit("grace@example.com");
    unmount([...cleanups, ...mount()]);
    expect(stored.has(REMEMBERED_EMAIL_KEY)).toBe(false);
  });

  it("writes nothing after a FAILED sign-in, even if the cookie changes afterwards", () => {
    let cleanups = mount();
    submit("grace@example.com");
    h.result.current = { error: "Incorrect email or password." }; // the action answered: a failure
    render();
    cleanups = [...cleanups, ...mount()]; // effects run after the failure result arrives
    doc.cookie = "sb-abc-auth-token=base64-AAA";
    unmount(cleanups);
    expect(stored.has(REMEMBERED_EMAIL_KEY)).toBe(false);
  });

  it("writes nothing when nothing was submitted", () => {
    doc.cookie = "sb-abc-auth-token=base64-AAA";
    unmount(mount());
    expect(stored.has(REMEMBERED_EMAIL_KEY)).toBe(false);
  });
});
