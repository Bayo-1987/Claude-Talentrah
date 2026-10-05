// Shared state between tests/setup.ts (which registers the unsafe default for the spend tally) and tests that exercise the tripwire itself.
export const tripwire: { touches: string[] } = ((globalThis as unknown as { __farahTripwire?: { touches: string[] } }).__farahTripwire ??= { touches: [] });
/** Returns and clears what the unsafe default recorded. A test that expects to touch it calls this so the afterEach check passes. */
export function consumeTripwireTouches(): string[] {
  return tripwire.touches.splice(0);
}
