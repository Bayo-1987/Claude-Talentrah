/**
 * send-514 — the app has no GraphQL consumer, so dropping pg_graphql (0211) changes nothing in src or the client.
 * docs/pg-graphql-investigation.md found no caller by four independent methods; this keeps the repo side of that true.
 */
import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";

describe("no GraphQL consumer in the app", () => {
  it("nothing under src, e2e or scripts calls /graphql/v1 or imports a GraphQL client", () => {
    const hits = execSync(
      `git grep -n -i -E "graphql/v1|from [\\"']graphql|@apollo/client|urql|graphql-request|pg_graphql" -- src e2e scripts ':!scripts/audit-migrations.ts' || true`,
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
    expect(hits).toEqual([]);
  });

  it("package.json has no GraphQL client dependency", () => {
    const pkg = execSync("git show HEAD:package.json", { encoding: "utf8" });
    expect(pkg).not.toMatch(/"(graphql|graphql-request|@apollo\/client|urql|graphql-tag)"/);
  });
});
