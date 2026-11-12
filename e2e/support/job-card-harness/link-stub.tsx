import type { AnchorHTMLAttributes } from "react";

/** next/link outside Next: an anchor that records where it would have gone instead of navigating the blank test document. */
export default function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        e.preventDefault();
        window.__navigated.push(href);
      }}
    />
  );
}
