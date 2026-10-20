import { InstallStripLazy } from "@/components/pwa/install-strip-lazy";

/**
 * The install-to-home-screen strip for the employer shell: the SAME strip the seeker shell mounts (src/components/pwa/install-strip-lazy.tsx), not a copy, behind the kill switch.
 *
 * `PWA_KILL=1` renders nothing at all. The page-side bootstrap already stops capturing the install prompt under the kill switch, but the iOS "Add to Home Screen" hint needs no
 * prompt event, so without this check an iPhone Safari employer would still be shown a hint to install an app whose worker has been switched off. The variable is read when this renders
 * (the employer layout is dynamic: it reads the session), not when the module loads.
 *
 * A Server Component with no client code of its own; the layout mounts it in the signed-in branch only, last in the shell (src/app/employer/layout.tsx).
 */
export function EmployerInstallStrip() {
  if (process.env.PWA_KILL === "1") return null;
  return <InstallStripLazy />;
}
