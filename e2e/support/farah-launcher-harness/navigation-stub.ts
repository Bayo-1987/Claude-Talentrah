export function usePathname(): string {
  return (window as unknown as { __pathname?: string }).__pathname ?? "/jobs";
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams((window as unknown as { __search?: string }).__search ?? "");
}
