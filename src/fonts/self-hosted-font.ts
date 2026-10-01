/**
 * The object `next/font/google` used to return — `{ className, variable, style }` — for a family whose CSS now lives in
 * src/fonts/<slug>/<slug>.css.
 *
 * `className` puts the family (with its metric-matched fallback) on an element; `variable` puts the `--font-*` custom
 * property in scope for the elements inside it. Only `variable` is used by this codebase, through `typefaceVariable` /
 * `fontScopeClassName` and the resume templates. The class names are fixed strings rather than CSS-module hashes, so they
 * are the same in a build and under vitest and two families can always be told apart.
 */
export interface SelfHostedFont {
  className: string;
  variable: string;
  style: { fontFamily: string; fontStyle?: "normal" };
}

export function selfHostedFont({
  slug,
  family,
  singleStyle,
}: {
  slug: string;
  family: string;
  /** `next/font` adds `font-style: normal` when only one style was requested. */
  singleStyle: boolean;
}): SelfHostedFont {
  return {
    className: `tal-font-${slug}`,
    variable: `tal-font-var-${slug}`,
    style: {
      fontFamily: `'${family}', '${family} Fallback'`,
      ...(singleStyle ? { fontStyle: "normal" as const } : {}),
    },
  };
}
