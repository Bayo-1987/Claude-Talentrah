export function usePathname(): string {
  return (window as unknown as { __pathname?: string }).__pathname ?? "/jobs";
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams((window as unknown as { __search?: string }).__search ?? "");
}

/** The account menu prefetches Refer a Friend when it mounts (PrefetchOnMount); there is no router here, so a prefetch is a no-op. */
export function useRouter(): { prefetch: (href: string) => void } {
  return { prefetch: () => undefined };
}
