import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BODY_MAX, DAILY_MESSAGE_LIMIT, MESSAGE_KINDS, SUBJECT_MAX } from "@/lib/employer/applicant-messages/constants";

const SQL = readFileSync(join(__dirname, "..", "..", "..", "supabase/migrations/0256_applicant_messages.sql"), "utf8");

describe("the app's limits and kinds are the database's (0256), read from the migration text", () => {
  it("the kind list is the CHECK list", () => {
    const m = /kind\s+text not null check \(kind in \(([^)]*)\)\)/.exec(SQL);
    expect(m, "the kind CHECK was not found").not.toBeNull();
    const kinds = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect([...kinds].sort()).toEqual([...MESSAGE_KINDS].sort());
  });

  it("the subject and body limits are the CHECK limits", () => {
    expect(SQL).toContain(`char_length(subject) between 1 and ${SUBJECT_MAX}`);
    expect(SQL).toContain(`char_length(body) between 1 and ${BODY_MAX}`);
  });

  it("the daily limit is the function's default", () => {
    expect(SQL).toContain(`p_daily_limit integer default ${DAILY_MESSAGE_LIMIT}`);
  });
});
