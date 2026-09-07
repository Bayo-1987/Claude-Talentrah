/**
 * `next/font/google` only works inside Next's own build (its SWC plugin
 * rewrites the call at compile time into a real self-hosted font reference);
 * imported under plain Vite/Node, as vitest does, the real package has
 * nothing to return and throws. `server-only` gets the same treatment for
 * the same reason — see the alias next to this one in vitest.config.ts.
 *
 * This stub returns the same SHAPE `next/font/google` returns
 * (`{ className, variable, style }`), which is all any test needs: nothing
 * under vitest renders real CSS, so the exact font-family value stored in
 * `style.fontFamily` doesn't matter, only that `.variable` is a stable,
 * distinct string per call site so `fontScopeClassName`
 * (skeletons/token-classes.ts) can still tell two typefaces apart.
 */
type FontOptions = { variable?: string };

function mockFont({ variable }: FontOptions) {
  const cssVar = variable ?? "--font-mock";
  return {
    className: `mock-font${cssVar}`,
    variable: cssVar,
    style: { fontFamily: `mock-font-family${cssVar}` },
  };
}

export function Poppins(options: FontOptions) {
  return mockFont(options);
}
export function Work_Sans(options: FontOptions) {
  return mockFont(options);
}
export function Lora(options: FontOptions) {
  return mockFont(options);
}
export function Barlow_Condensed(options: FontOptions) {
  return mockFont(options);
}
export function Newsreader(options: FontOptions) {
  return mockFont(options);
}
export function Source_Sans_3(options: FontOptions) {
  return mockFont(options);
}
