/**
 * Account deletion removes a user's Farah history. DATABASE-BACKED, CI only.
 *
 * Message history is written by the server only, so no client role holds a write privilege on farah_messages. Deleting an account removes the rows through the profiles foreign key
 * (farah_messages_user_id_fkey, ON DELETE CASCADE), which Postgres performs as the table's owner and which does not depend on those grants. This test pins that: the rows are gone after the
 * account is, whatever the signed-in role may do to the table directly.
 */
import { describe, expect, it } from "vitest";
import { admin } from "../support/auth";

describe("deleting an account removes its Farah history", () => {
  it("the cascade removes the rows even though no client role may delete them", async () => {
    const email = `farah-cascade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, email_confirm: true });
    expect(createError).toBeNull();
    const userId = created.user!.id;
    try {
      const { error: seedError } = await admin.from("farah_messages").insert([
        { user_id: userId, role: "user", content: "a question" },
        { user_id: userId, role: "farah", content: "an answer" },
      ]);
      expect(seedError).toBeNull();
      const before = await admin.from("farah_messages").select("id", { count: "exact", head: true }).eq("user_id", userId);
      expect(before.count).toBe(2);

      const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
      expect(deleteError).toBeNull();

      const after = await admin.from("farah_messages").select("id", { count: "exact", head: true }).eq("user_id", userId);
      expect(after.error).toBeNull();
      expect(after.count, "the cascade must remove the history with the account").toBe(0);
    } finally {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }
  });
});
