/**
 * What supabase-js's rpc() really returns: a thenable (it has `then`), NOT a Promise. It has no `.catch` and no `.finally`, so code that writes `rpc(...).catch(...)` works against a mock that
 * returns a Promise and throws "catch is not a function" against the real client (that is how the first version of the free-claim code passed every mocked test and failed in CI, where the real
 * client runs). Every fake `rpc` in the Farah tests goes through these two, so a method that only a Promise has cannot be used without a test failing.
 */
export type RpcAnswer = { data: unknown; error: { message: string; code?: string } | null };

export function realRpcBuilder<T>(answer: T): PromiseLike<T> {
  return { then: (onFulfilled, onRejected) => Promise.resolve(answer).then(onFulfilled, onRejected) };
}

/** The same shape, but awaiting it rejects (a lost connection, a thrown fetch). */
export function rejectingRpcBuilder(error: unknown): PromiseLike<never> {
  return { then: (onFulfilled, onRejected) => Promise.reject(error).then(onFulfilled, onRejected) };
}
