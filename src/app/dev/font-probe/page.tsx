import { poppins, workSans, lora, barlowCondensed } from "@/components/resume-builder/skeletons/fonts";
import { resumeSourceSans } from "@/components/resume-builder/templates/fonts";

// THROWAWAY DIAGNOSTIC (send-473) — never merged. One PDF, many faces, identical text.
export const SENTENCES = {
  s1: "Professional certifications and key projects: AWS Certified Solutions Architect, PMP certification, TypeScript and Kubernetes.",
  s2: "Led the migration of the settlement ledger to an event-sourced model, cutting incident triage time in half across three teams.",
  s3: "ZQCERTIFICATIONS ZQPROJECTS ZQSKILLS ZQEXPERIENCE ZQEDUCATION ZQSUMMARY",
  s4: "PROFESSIONAL CERTIFICATIONS KEY PROJECTS EDUCATION",
};

type Block = { id: string; note: string; className?: string; style?: React.CSSProperties };
const BLOCKS: Block[] = [
  { id: "F01", note: "app-inherited (no class; body -> IBM Plex Sans)" },
  { id: "F02", note: "plex 600", style: { fontWeight: 600 } },
  { id: "F03", note: "plex 12px", style: { fontSize: 12 } },
  { id: "F04", note: "plex 16px", style: { fontSize: 16 } },
  { id: "F05", note: "plex 20px", style: { fontSize: 20 } },
  { id: "F06", note: "plex kerning:none", style: { fontKerning: "none" } },
  { id: "F07", note: "plex text-rendering:optimizeSpeed", style: { textRendering: "optimizeSpeed" } },
  { id: "F08", note: "plex liga off", style: { fontVariantLigatures: "none" } },
  { id: "F09", note: "source sans 3", className: "font-resume-body" },
  { id: "F10", note: "source sans 3 600", className: "font-resume-body", style: { fontWeight: 600 } },
  { id: "F11", note: "source sans 3 20px", className: "font-resume-body", style: { fontSize: 20 } },
  { id: "F12", note: "work sans", className: "font-humanist" },
  { id: "F13", note: "poppins", className: "font-geometric" },
  { id: "F14", note: "lora", className: "font-serif-modern" },
  { id: "F15", note: "barlow condensed", className: "font-condensed" },
  { id: "F16", note: "newsreader", className: "font-display" },
  { id: "F17", note: "system Arial", style: { fontFamily: "Arial" } },
  { id: "F18", note: "system sans-serif", style: { fontFamily: "sans-serif" } },
  { id: "F19", note: "system serif", style: { fontFamily: "serif" } },
  { id: "F20", note: "plex TRACKED uppercase 0.1em", style: { letterSpacing: "0.1em", textTransform: "uppercase" } },
  { id: "F21", note: "source sans TRACKED uppercase 0.1em", className: "font-resume-body", style: { letterSpacing: "0.1em", textTransform: "uppercase" } },
  { id: "F22", note: "barlow TRACKED uppercase 0.1em", className: "font-condensed", style: { letterSpacing: "0.1em", textTransform: "uppercase" } },
];

export default function FontProbe() {
  const scope = [resumeSourceSans.variable, workSans.variable, poppins.variable, lora.variable, barlowCondensed.variable].join(" ");
  return (
    <div className={`bg-white p-8 text-black ${scope}`}>
      {BLOCKS.map((b) => (
        <section key={b.id} className={b.className} style={{ fontSize: 13.5, marginBottom: 14, ...b.style }}>
          <p>[{b.id}]</p>
          <p>{SENTENCES.s1}</p>
          <p>{SENTENCES.s2}</p>
          <p>{SENTENCES.s3}</p>
          <p>{SENTENCES.s4}</p>
        </section>
      ))}
    </div>
  );
}
