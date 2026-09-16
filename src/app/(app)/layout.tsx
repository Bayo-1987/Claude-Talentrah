import { AppShell } from "@/components/app-shell/app-shell";

/**
 * Thin layout — all shell logic lives in AppShell (src/components/app-shell/
 * app-shell.tsx), extracted so a second layout.tsx (the public,
 * existence-gated pages that can't share this segment's loading.tsx
 * ancestry) can render the identical shell without duplicating it. This
 * file itself must stay a pure pass-through — any real logic added here
 * would need to be duplicated in that second layout too.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
