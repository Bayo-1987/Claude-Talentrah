/**
 * The saved PDF's default filename comes from `document.title` at the moment
 * the print dialog opens, so both Save-as-PDF buttons set it to
 * `<First>-<Last>-Resume` for the print and put the real title back after.
 *
 * Vitest here runs in `environment: "node"` with no DOM, so `printWithTitle`
 * takes the document / window / print function as arguments and these tests
 * pass fakes — the same approach wait-for-fonts.test.ts uses for
 * `document.fonts`.
 */
import { describe, expect, it } from "vitest";
import { printWithTitle, resumePrintTitle } from "@/lib/resume-builder/print-title";

describe("resumePrintTitle", () => {
  it.each([
    ["Ada Obi", "Ada-Obi-Resume"],
    ["  Ada   Obi  ", "Ada-Obi-Resume"],
    // First and last only — a middle name never reaches the filename.
    ["Ada Grace Obi", "Ada-Obi-Resume"],
    ["Chidinma Eze-Okafor", "Chidinma-Eze-Okafor-Resume"],
    ["Ada", "Ada-Resume"],
    // Unicode letters are kept; this is a filename, not an ASCII slug.
    ["Ọlá Adéyẹmí", "Ọlá-Adéyẹmí-Resume"],
    // Characters a filesystem refuses are dropped, not kept or replaced.
    ['Ada "Ace" O/bi', "Ada-Obi-Resume"],
    ["Ada\tObi\n", "Ada-Obi-Resume"],
    // Nothing usable falls back to the plain word rather than "-Resume".
    ["", "Resume"],
    ["   ", "Resume"],
    [undefined, "Resume"],
    ["///", "Resume"],
  ])("%j -> %s", (name, expected) => {
    expect(resumePrintTitle(name)).toBe(expected);
  });
});

/** A minimal document + window pair that records title writes and lets a test fire `afterprint`. */
function fakeEnv(initialTitle = "Edit resume — Talentrah") {
  const listeners = new Set<() => void>();
  const doc = { title: initialTitle };
  // The fallback timer is captured, not run: a test fires it by hand.
  let fallback: (() => void) | undefined;
  const win = {
    addEventListener: (type: string, fn: () => void) => {
      if (type === "afterprint") listeners.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => {
      if (type === "afterprint") listeners.delete(fn);
    },
    setTimeout: (handler: () => void) => {
      fallback = handler;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: () => {
      fallback = undefined;
    },
  };
  return {
    doc,
    win,
    fireAfterPrint: () => [...listeners].forEach((fn) => fn()),
    listenerCount: () => listeners.size,
    /** The scheduled fallback restore, if one is pending. */
    pendingFallback: () => fallback,
  };
}

describe("printWithTitle", () => {
  it("has the resume title in place while print() runs", () => {
    const env = fakeEnv();
    let titleDuringPrint: string | undefined;
    printWithTitle("Ada-Obi-Resume", {
      doc: env.doc,
      win: env.win,
      print: () => {
        titleDuringPrint = env.doc.title;
      },
    });
    expect(titleDuringPrint).toBe("Ada-Obi-Resume");
  });

  it("restores the original title on afterprint, and not before", () => {
    const env = fakeEnv();
    printWithTitle("Ada-Obi-Resume", { doc: env.doc, win: env.win, print: () => {} });
    // print() has returned but the browser has not said it is finished: a
    // non-blocking print UI may still be reading the title.
    expect(env.doc.title).toBe("Ada-Obi-Resume");
    env.fireAfterPrint();
    expect(env.doc.title).toBe("Edit resume — Talentrah");
    expect(env.listenerCount(), "the afterprint listener must not leak").toBe(0);
  });

  it("restores the original title and rethrows when print() throws", () => {
    const env = fakeEnv();
    expect(() =>
      printWithTitle("Ada-Obi-Resume", {
        doc: env.doc,
        win: env.win,
        print: () => {
          throw new Error("print blocked");
        },
      }),
    ).toThrow("print blocked");
    expect(env.doc.title).toBe("Edit resume — Talentrah");
    expect(env.listenerCount()).toBe(0);
  });

  it("restores through the fallback timer if afterprint never fires", () => {
    const env = fakeEnv();
    printWithTitle("Ada-Obi-Resume", { doc: env.doc, win: env.win, print: () => {} });
    const fallback = env.pendingFallback();
    expect(fallback, "a fallback restore must be scheduled").toBeTypeOf("function");
    fallback!();
    expect(env.doc.title).toBe("Edit resume — Talentrah");
  });

  it("restores exactly once when afterprint and the fallback both fire", () => {
    const env = fakeEnv();
    printWithTitle("Ada-Obi-Resume", { doc: env.doc, win: env.win, print: () => {} });
    const fallback = env.pendingFallback()!;
    env.fireAfterPrint();
    // Something else (a route change) retitles the page before the late timer.
    env.doc.title = "Resume Builder — Talentrah";
    fallback();
    expect(env.doc.title, "the late fallback must not overwrite a newer title").toBe("Resume Builder — Talentrah");
  });
});
