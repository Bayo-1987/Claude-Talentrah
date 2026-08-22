// "server-only" throws unconditionally when imported outside Next's own
// bundler (see scripts/seed.ts's comment on the same issue) — Vitest runs in
// plain Node, so alias it to this no-op for tests instead.
export {};
