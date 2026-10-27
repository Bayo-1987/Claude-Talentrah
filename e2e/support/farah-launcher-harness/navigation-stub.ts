export function usePathname(): string {
  return (window as unknown as { __pathname?: string }).__pathname ?? "/jobs";
}
