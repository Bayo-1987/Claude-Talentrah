/**
 * Farah's brand mark — two overlapping circles, nothing else. No stock
 * photography or fake human avatars for Farah anywhere in the product
 * (design handoff §7).
 */
export function FarahMark({ size = 200 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 220 220" fill="none" aria-hidden="true">
      <circle cx="110" cy="110" r="108" fill="var(--rust-soft)" />
      <circle cx="88" cy="96" r="46" stroke="var(--rust)" strokeWidth="2.2" fill="none" />
      <circle cx="132" cy="128" r="46" stroke="var(--ink)" strokeWidth="2.2" fill="none" />
      <circle cx="110" cy="112" r="5" fill="var(--rust)" />
    </svg>
  );
}
