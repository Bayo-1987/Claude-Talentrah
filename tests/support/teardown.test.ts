/**
 * The teardown helper, and the failure it was written for.
 *
 * A hook written as delete → check → throw → delete → check → throw abandons
 * everything after the first failure. e2e/admin-blog was exactly that shape:
 * a refused `blog_posts` delete meant the `admin_users` row was never removed,
 * leaving an OPERATOR — an admin holding real permissions — in a database
 * every other run shares. The suite reported the post failure and silently
 * created a worse one that surfaces later, somewhere unrelated.
 *
 * So the guarantee is not "cleanup is attempted". It is "every step runs, and
 * the report names all of them".
 */
import { describe, expect, it, vi } from "vitest";
import { mustDelete, runCleanups } from "./teardown";

describe("runCleanups", () => {
  it("runs every step when they all succeed", async () => {
    const ran: string[] = [];
    await runCleanups(
      ["a", async () => void ran.push("a")],
      ["b", async () => void ran.push("b")],
    );
    expect(ran).toEqual(["a", "b"]);
  });

  it("runs LATER steps even when an earlier one throws", async () => {
    // The whole point. Under the old pattern "c" never ran.
    const ran: string[] = [];
    await expect(
      runCleanups(
        ["a", async () => void ran.push("a")],
        ["b", async () => { throw new Error("refused"); }],
        ["c", async () => void ran.push("c")],
      ),
    ).rejects.toThrow();
    expect(ran, "a failure abandoned the steps after it").toEqual(["a", "c"]);
  });

  it("preserves order, because FK order is real", async () => {
    // postings before organisations, admin_users before roles.
    const ran: string[] = [];
    await runCleanups(
      ["1", async () => void ran.push("1")],
      ["2", async () => void ran.push("2")],
      ["3", async () => void ran.push("3")],
    );
    expect(ran).toEqual(["1", "2", "3"]);
  });

  it("reports EVERY failure, not just the first", async () => {
    // A run that broke three things should say three, or it gets fixed a
    // third of the way.
    const err = await runCleanups(
      ["posts", async () => { throw new Error("post refused"); }],
      ["operator", async () => { throw new Error("operator refused"); }],
      ["role", async () => { throw new Error("role refused"); }],
    ).catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain("3 step(s)");
    for (const fragment of ["post refused", "operator refused", "role refused"]) {
      expect(message, `the report omitted "${fragment}"`).toContain(fragment);
    }
  });

  it("stays silent when nothing failed", async () => {
    await expect(runCleanups(["a", async () => {}])).resolves.toBeUndefined();
  });
});

describe("mustDelete", () => {
  it("throws on the error a rejected Supabase delete RESOLVES with", async () => {
    /*
     * The failure mode this repo has hit repeatedly: `await
     * admin.from(x).delete()` does not throw when refused, it resolves with an
     * `error`. Ten cleanup sites ignored it and reported success for weeks.
     */
    const refused = Promise.resolve({ error: { message: "23503 foreign key" } });
    await expect(mustDelete("orgs", refused)).rejects.toThrow(/23503/);
  });

  it("passes through a successful delete", async () => {
    await expect(mustDelete("orgs", Promise.resolve({ error: null }))).resolves.toBeUndefined();
  });

  it("is what makes a silent refusal loud inside runCleanups", async () => {
    const ran = vi.fn();
    await expect(
      runCleanups(
        ["first", () => mustDelete("x", Promise.resolve({ error: { message: "refused" } }))],
        ["second", async () => void ran()],
      ),
    ).rejects.toThrow(/refused/);
    expect(ran, "the step after a silent refusal did not run").toHaveBeenCalled();
  });
});
