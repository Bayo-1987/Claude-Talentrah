import { describe, expect, it } from "vitest";
import { batchIdempotencyKey } from "@/lib/admin/messages/idempotency";

/**
 * Fix 1 of the build spec: a batch's idempotency key comes from the batch's RECIPIENT SET (ids, never addresses), so a resumed send that regroups recipients can never hand one key to two different sets.
 */
const MESSAGE = "11111111-1111-4111-8111-111111111111";
const OTHER_MESSAGE = "22222222-2222-4222-8222-222222222222";
const ids = (...n: number[]) => n.map((i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

describe("the batch idempotency key", () => {
  it("the same recipient set yields the same key in any order", () => {
    const a = batchIdempotencyKey(MESSAGE, ids(1, 2, 3));
    expect(batchIdempotencyKey(MESSAGE, ids(3, 1, 2))).toBe(a);
    expect(batchIdempotencyKey(MESSAGE, ids(2, 3, 1))).toBe(a);
  });

  it("a resumed send that regroups recipients never reuses a key for a different recipient set", () => {
    // first run: batches [1,2] and [3,4]; the resumed run regroups the same people as [1,2,3] and [4]
    const first = [batchIdempotencyKey(MESSAGE, ids(1, 2)), batchIdempotencyKey(MESSAGE, ids(3, 4))];
    const regrouped = [batchIdempotencyKey(MESSAGE, ids(1, 2, 3)), batchIdempotencyKey(MESSAGE, ids(4))];
    for (const key of regrouped) expect(first).not.toContain(key);
    // and a message id plus a batch INDEX would have collided here: index 0 holds a different set, so the keys must differ
    expect(batchIdempotencyKey(MESSAGE, ids(1, 2))).not.toBe(batchIdempotencyKey(MESSAGE, ids(1, 2, 3)));
  });

  it("the same recipients under a different message id yield a different key", () => {
    expect(batchIdempotencyKey(MESSAGE, ids(1, 2))).not.toBe(batchIdempotencyKey(OTHER_MESSAGE, ids(1, 2)));
  });

  it("a retried batch with an unchanged set reuses its key", () => {
    expect(batchIdempotencyKey(MESSAGE, ids(5, 6, 7))).toBe(batchIdempotencyKey(MESSAGE, ids(5, 6, 7)));
  });

  it("is hex, well under the provider's 256-character limit, and does not repeat an id (a person listed twice is one person)", () => {
    const key = batchIdempotencyKey(MESSAGE, ids(1, 2, 3));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key.length).toBeLessThan(256);
    expect(batchIdempotencyKey(MESSAGE, [...ids(1, 2), ...ids(1)])).toBe(batchIdempotencyKey(MESSAGE, ids(1, 2)));
  });

  it("is computed from ids and nothing else: an address-shaped value is not an accepted input", () => {
    // the helper's signature takes ids; feeding it addresses is the mutant, and an id-shaped check is how the test tells them apart
    expect(() => batchIdempotencyKey(MESSAGE, ["zq7.first.last@example.test"])).toThrow(/id/i);
  });
});
