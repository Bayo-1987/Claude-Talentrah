/**
 * The first-visit Farah hint's test id, in one place. The hint renders it (src/components/app-shell/farah-first-visit-hint.tsx) and the install strip finds the hint by it
 * (src/lib/pwa/install-state.ts, watch-relevant-changes.ts): the strip hides itself while the hint is on screen on a phone. tests/app-shell/farah-hint-test-id.test.ts fails if
 * either side stops using this or the value changes.
 */
export const FARAH_FIRST_VISIT_HINT_TEST_ID = "farah-first-visit-hint";
