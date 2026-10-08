/**
 * revalidateEmbed (src/lib/embed/revalidate.ts): the one call every place that changes what the employer job-list widget shows makes, so a closed job leaves the embedded list in
 * seconds instead of at the 30-minute cache TTL.
 *
 * It must never fail the caller's real work (an employer closing a job is not undone because a cache purge threw), must ignore an id that is not an organisation id, and must purge
 * exactly the one path the embed route serves for that organisation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

import { embedPathFor, revalidateEmbed, revalidateEmbedForOrganizations } from "@/lib/embed/revalidate";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  revalidatePath.mockReset();
});

describe("revalidateEmbed", () => {
  it("purges exactly the embed path for that organisation", () => {
    revalidateEmbed(A);
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith(`/embed/jobs/${A}`);
    expect(embedPathFor(A)).toBe(`/embed/jobs/${A}`);
  });

  it("does nothing for null, undefined or something that is not an organisation id", () => {
    for (const bad of [null, undefined, "", "x", "../admin", `${A}/../${B}`]) revalidateEmbed(bad as never);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("never throws, even when the purge itself does (outside a request, or a platform error)", () => {
    revalidatePath.mockImplementation(() => {
      throw new Error("Invariant: static generation store missing");
    });
    expect(() => revalidateEmbed(A)).not.toThrow();
  });
});

describe("revalidateEmbedForOrganizations", () => {
  it("purges each distinct organisation once and skips empties", () => {
    revalidateEmbedForOrganizations([A, B, A, null, undefined, ""]);
    expect(revalidatePath.mock.calls.map((c) => c[0]).sort()).toEqual([`/embed/jobs/${A}`, `/embed/jobs/${B}`]);
  });

  it("keeps purging the rest when one purge throws", () => {
    revalidatePath.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(() => revalidateEmbedForOrganizations([A, B])).not.toThrow();
    expect(revalidatePath).toHaveBeenCalledTimes(2);
  });
});
