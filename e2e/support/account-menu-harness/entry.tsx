/**
 * The page the account-menu spec loads: the REAL seeker Masthead and the REAL EmployerMasthead, mounted into a blank document with the app's real compiled stylesheet. Only three
 * modules are replaced (see build.ts): next/link, next/navigation and the sign-out Server Action, none of which can run outside a Next.js server. Everything else is the product code.
 */
import { createRoot } from "react-dom/client";
import { Masthead } from "@/components/app-shell/masthead";
import { EmployerMasthead } from "@/components/employer/employer-masthead";

type Kind = "seeker" | "employer";
declare global {
  interface Window {
    __mount: (kind: Kind, props: Record<string, unknown>) => void;
    __signOuts: number;
    __navigated: string[];
  }
}

window.__signOuts = 0;
window.__navigated = [];
window.__mount = (kind, props) => {
  const el = document.getElementById("root");
  if (!el) throw new Error("no root");
  const Component = (kind === "seeker" ? Masthead : EmployerMasthead) as unknown as (p: Record<string, unknown>) => React.ReactNode;
  createRoot(el).render(<Component {...props} />);
};
