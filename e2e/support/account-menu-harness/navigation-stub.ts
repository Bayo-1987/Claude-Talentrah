export function usePathname(): string {
  return (window as unknown as { __pathname?: string }).__pathname ?? "/employer/jobs";
}

/** The account menu prefetches Refer a Friend when it mounts (PrefetchOnMount); there is no router here, so a prefetch is a no-op. */
export function useRouter(): { prefetch: (href: string) => void } {
  return { prefetch: () => undefined };
}
