import { registeredSlugs } from "@/components/resume-builder/templates";

// THROWAWAY DIAGNOSTIC (send-473) — never merged.
export default function Slugs() {
  return <pre id="slugs">{JSON.stringify(registeredSlugs())}</pre>;
}
