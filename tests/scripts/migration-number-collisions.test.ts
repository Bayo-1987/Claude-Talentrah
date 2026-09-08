/**
 * The collision guard, exercised with fixtures rather than only by real CI.
 *
 * The cases below are the six that actually happened, by number, because a
 * guard written for a hypothetical is a guard nobody checked against the thing
 * it exists for. The most important one is `0113`: two files, both added, both
 * merged, main red — which is the shape this check has to catch BEFORE either
 * lands.
 */
import { describe, expect, it } from "vitest";
import {
  migrationNumber,
  findCollisions,
  describeCollisions,
} from "../../scripts/migration-number-collisions";

const M = (name: string) => `supabase/migrations/${name}`;

describe("reading a migration's number", () => {
  it("takes the four-digit prefix", () => {
    expect(migrationNumber(M("0113_storage_usage_reader.sql"))).toBe("0113");
    expect(migrationNumber("0000_baseline_schema.sql")).toBe("0000");
  });

  it("ignores anything not following the convention, rather than guessing", () => {
    // README.md lives in that directory and is not a migration.
    expect(migrationNumber(M("README.md"))).toBeNull();
    expect(migrationNumber(M("fix_something.sql"))).toBeNull();
    // 0114b exists on a branch; it is not a plain four-digit prefix, and
    // treating it as "0114" would report a collision that a rename already
    // resolved deliberately.
    expect(migrationNumber(M("0114b_close_org_insert_self_verify_hole.sql"))).toBeNull();
    // Not anchored loosely: a number later in the name is not a prefix.
    expect(migrationNumber(M("fix_0113_thing.sql"))).toBeNull();
  });
});

describe("the collision that actually took main down", () => {
  const onMain = [
    M("0112_onboarding_skipped_marker.sql"),
    M("0113_storage_usage_reader.sql"),
  ];

  it("catches a branch adding a second 0113", () => {
    const found = findCollisions([M("0113_organization_and_posting_insert_hardening.sql")], onMain);
    expect(found).toHaveLength(1);
    expect(found[0].number).toBe("0113");
    expect(found[0].existing).toEqual([M("0113_storage_usage_reader.sql")]);
  });

  it("names BOTH files, so the log says what it collided with", () => {
    const message = describeCollisions(
      findCollisions([M("0113_organization_and_posting_insert_hardening.sql")], onMain),
    );
    expect(message).toContain("0113_organization_and_posting_insert_hardening.sql");
    expect(message).toContain("0113_storage_usage_reader.sql");
    expect(message).toContain("whichever lands SECOND renumbers");
  });

  it("passes the next free number", () => {
    expect(findCollisions([M("0114_job_posting_banners.sql")], onMain)).toEqual([]);
  });
});

describe("every historical collision this repo has had", () => {
  // Each pair is a real one. A guard that only handles the most recent case
  // would have shipped five times without catching anything.
  const historical: Array<[string, string]> = [
    ["0060_admin_identity.sql", "0060_course_recommendations.sql"],
    ["0103_people_list_permission.sql", "0103_resume_template_ats_safety.sql"],
    ["0106_blueprint_certifications_label.sql", "0106_unlisted_job_links.sql"],
    ["0110_template_free_tier_cut.sql", "0110_persona_layout_token_retune.sql"],
    ["0110_template_free_tier_cut.sql", "0110_onboarding_skipped_marker.sql"],
    ["0113_storage_usage_reader.sql", "0113_organization_and_posting_insert_hardening.sql"],
  ];

  it.each(historical)("catches %s vs %s", (first, second) => {
    const found = findCollisions([M(second)], [M(first)]);
    expect(found, `${second} should have collided with ${first}`).toHaveLength(1);
  });
});

describe("what it must NOT flag", () => {
  const onMain = [
    M("0113_storage_usage_reader.sql"),
    M("0114_organization_and_posting_insert_hardening.sql"),
    M("0115_job_posting_banners.sql"),
  ];

  it("a branch adding nothing", () => {
    expect(findCollisions([], onMain)).toEqual([]);
  });

  it("a file that is on BOTH sides — that is one file, not two", () => {
    /*
     * A behind branch's diff can still list a file that main already has. That
     * is not a collision, and reporting it would make the check fire on every
     * stale branch until it was ignored entirely.
     */
    expect(findCollisions([M("0115_job_posting_banners.sql")], onMain)).toEqual([]);
  });

  it("a GAP in the numbering", () => {
    // A renumber leaves the old slot empty. Legitimate, and flagging it would
    // train people to skip the check.
    expect(findCollisions([M("0118_something.sql")], onMain)).toEqual([]);
  });

  it("a non-migration file in the same directory", () => {
    expect(findCollisions([M("README.md")], onMain)).toEqual([]);
  });

  it("says so plainly when there is nothing to report", () => {
    expect(describeCollisions([])).toMatch(/No migration-number collisions/);
  });
});

describe("more than one collision at once", () => {
  it("reports every one, not just the first", () => {
    const onMain = [M("0113_a.sql"), M("0114_b.sql")];
    const found = findCollisions([M("0113_x.sql"), M("0114_y.sql"), M("0115_ok.sql")], onMain);
    expect(found.map((c) => c.number)).toEqual(["0113", "0114"]);
    const message = describeCollisions(found);
    expect(message).toContain("2 migrations");
  });

  it("lists every existing file when main somehow already has two", () => {
    // Defensive: if main is ALREADY broken, this must not hide half of it.
    const onMain = [M("0113_a.sql"), M("0113_b.sql")];
    const found = findCollisions([M("0113_c.sql")], onMain);
    expect(found[0].existing).toEqual([M("0113_a.sql"), M("0113_b.sql")]);
  });
});
