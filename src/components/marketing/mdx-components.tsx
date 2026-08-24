import type { MDXComponents } from "mdx/types";

/**
 * Editorial-system typography for rendered MDX blog bodies (src/app/blog/[slug]).
 * Kept separate from LegalPage's prose classes (legal-page.tsx) since that's
 * a wrapper-scoped Tailwind selector, not per-element components — this one
 * needs actual component overrides because next-mdx-remote renders real
 * elements, not raw HTML we can target with [&_h2].
 */
export const mdxComponents: MDXComponents = {
  h2: (props) => <h2 className="mt-2 text-[22px] text-ink" {...props} />,
  h3: (props) => <h3 className="mt-1 text-[18px] text-ink" {...props} />,
  p: (props) => <p className="text-[15.5px] leading-[1.75] text-ink-soft" {...props} />,
  a: (props) => (
    <a className="text-rust underline underline-offset-2" {...props} />
  ),
  ul: (props) => (
    <ul className="flex flex-col gap-2 text-[15.5px] leading-[1.75] text-ink-soft" {...props} />
  ),
  li: (props) => <li className="ml-5 list-disc" {...props} />,
  strong: (props) => <strong className="text-ink" {...props} />,
};
