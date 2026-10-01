import { describe, expect, it } from "vitest";
import { loadModule } from "./load-module";

describe("loadModule", () => {
  it("resolves the @/ alias for a variable specifier (so it can stand in for a literal import)", async () => {
    const cn = await loadModule<typeof import("@/lib/cn")>("@/lib/cn");
    const direct = await import("@/lib/cn");
    expect(cn.cn).toBe(direct.cn);
  });

  it("rejects for a module that does not exist (so a missing module fails a test, not the typecheck)", async () => {
    await expect(loadModule("@/lib/this-module-does-not-exist-484")).rejects.toThrow();
  });
});
