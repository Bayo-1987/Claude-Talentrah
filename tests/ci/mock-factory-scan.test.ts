/** The factory scanner (tests/support/mock-factory-scan.ts) on synthetic files: it tells a hand-written factory from a shared helper and from a spread of the real module, and it only reads real vi.mock calls. */
import { describe, expect, it } from "vitest";
import { classifyFactory, findFactoryMocks } from "../support/mock-factory-scan";

describe("classifyFactory", () => {
  it("a hand-written object is hand", () => {
    expect(classifyFactory("() => ({ a, b })")).toBe("hand");
    expect(classifyFactory("() => ({ a: vi.fn().mockResolvedValue(1) })")).toBe("hand");
  });
  it("a spread of the real module is safe (importActual and importOriginal)", () => {
    expect(classifyFactory("async () => ({ ...(await vi.importActual<typeof import('x')>('x')), a })")).toBe("safe");
    expect(classifyFactory("async (importOriginal) => ({ ...(await importOriginal()), a })")).toBe("safe");
  });
  it("a factory built by a helper under support/ is shared", () => {
    expect(classifyFactory('async () => (await import("./support/route-mocks")).safeSpendTally()')).toBe("shared");
    expect(classifyFactory('async () => (await import("../support/x")).fake()')).toBe("shared");
    expect(classifyFactory('async () => (await import("./helpers/y")).fake()')).toBe("shared");
  });
  it("a dynamic import of something else is still hand", () => {
    expect(classifyFactory('async () => ({ a: (await import("./local-file")).a })')).toBe("hand");
  });
});

describe("findFactoryMocks", () => {
  it("reports module, kind and line for each vi.mock call with a factory", () => {
    const src = `import { vi } from "vitest";\nvi.mock("@/lib/a", () => ({ x }));\nvi.mock("@/lib/b", async () => (await import("./support/m")).safe());\n`;
    expect(findFactoryMocks(src)).toEqual([
      { module: "@/lib/a", kind: "hand", line: 2 },
      { module: "@/lib/b", kind: "shared", line: 3 },
    ]);
  });
  it("a file that mocks one module twice reports both", () => {
    const src = `vi.mock("@/lib/a", () => ({ x }));\nvi.mock("@/lib/a", () => ({ y }));\n`;
    expect(findFactoryMocks(src).map((m) => m.module)).toEqual(["@/lib/a", "@/lib/a"]);
  });
  it("an automock (no factory) is not reported", () => {
    expect(findFactoryMocks(`vi.mock("@/lib/a");`)).toEqual([]);
  });
  it("text that only looks like a call is not reported: a string, a comment, another object's mock()", () => {
    const src = `const s = 'vi.mock("@/lib/a", () => ({}))';\n// vi.mock("@/lib/b", () => ({}))\nother.mock("@/lib/c", () => ({}));\njest.mock("@/lib/d", () => ({}));\n`;
    expect(findFactoryMocks(src)).toEqual([]);
  });
  it("a template-literal module name is read too, and a non-literal module is skipped", () => {
    expect(findFactoryMocks("vi.mock(`@/lib/t`, () => ({}));").map((m) => m.module)).toEqual(["@/lib/t"]);
    expect(findFactoryMocks("const m = '@/lib/z';\nvi.mock(m, () => ({}));")).toEqual([]);
  });
  it("reads TSX files", () => {
    expect(findFactoryMocks(`const a = <div />;\nvi.mock("@/lib/a", () => ({}));`, "x.tsx").map((m) => m.module)).toEqual(["@/lib/a"]);
  });
});
