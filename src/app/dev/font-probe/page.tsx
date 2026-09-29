import { poppins, workSans, lora, barlowCondensed } from "@/components/resume-builder/skeletons/fonts";
import { resumeSourceSans } from "@/components/resume-builder/templates/fonts";

// THROWAWAY DIAGNOSTIC (send-473) — never merged. v2: ONE BLOCK PER PDF PAGE, long identical prose.
export const PROSE = [
  "Professional summary. Senior product manager with eleven years shipping payments, identity and marketplace products across Lagos, Nairobi and London. Led a cross-functional team of twenty engineers, designers and analysts to deliver a settlement platform processing millions of transactions daily. Reduced incident triage time by half through better observability, clearer ownership and disciplined post-incident reviews.",
  "Experience. Directed the migration of the settlement ledger to an event-sourced model, coordinating infrastructure, compliance and customer support. Negotiated partnerships with three regional banks and two mobile-money operators, expanding coverage to eight countries. Mentored junior colleagues, introduced quarterly roadmapping, and established a culture of measurable outcomes over activity.",
  "Education and certifications. Bachelor of Science in Computer Science from the University of Abuja. Certified Solutions Architect, Project Management Professional, and a graduate certificate in digital transformation. Associate member of the national association of software engineers; volunteer instructor teaching TypeScript, databases and Kubernetes to undergraduate students on weekends.",
  "Skills and projects. Stakeholder communication, strategic planning, negotiation, budgeting, analytics, experimentation, agile delivery, technical writing. Built a ledger replay tool that cut reconciliation effort dramatically, and an internal dashboard visualising conversion, retention and settlement latency for executives, operations managers and regional directors.",
];

type Block = { id: string; note: string; className?: string; style?: React.CSSProperties };
export const BLOCKS: Block[] = [
  { id: "F01", note: "plex 400 (app-inherited)" },
  { id: "F02", note: "plex 600", style: { fontWeight: 600 } },
  { id: "F03", note: "plex kerning:none", style: { fontKerning: "none" } },
  { id: "F04", note: "plex optimizeSpeed", style: { textRendering: "optimizeSpeed" } },
  { id: "F05", note: "source sans 3 400", className: "font-resume-body" },
  { id: "F06", note: "source sans 3 600", className: "font-resume-body", style: { fontWeight: 600 } },
  { id: "F07", note: "source sans 3 optimizeSpeed", className: "font-resume-body", style: { textRendering: "optimizeSpeed" } },
  { id: "F08", note: "work sans", className: "font-humanist" },
  { id: "F09", note: "poppins", className: "font-geometric" },
  { id: "F10", note: "lora", className: "font-serif-modern" },
  { id: "F11", note: "barlow condensed", className: "font-condensed" },
  { id: "F12", note: "newsreader", className: "font-display" },
  { id: "F13", note: "system Arial", style: { fontFamily: "Arial" } },
  { id: "F14", note: "system serif", style: { fontFamily: "serif" } },
];

export default function FontProbe() {
  const scope = [resumeSourceSans.variable, workSans.variable, poppins.variable, lora.variable, barlowCondensed.variable].join(" ");
  return (
    <div className={`bg-white text-black ${scope}`}>
      {BLOCKS.map((b) => (
        <section key={b.id} className={b.className} style={{ fontSize: 13.5, padding: 40, breakAfter: "page", ...b.style }}>
          <p>[{b.id}] {b.note}</p>
          {PROSE.map((p, i) => (
            <p key={i} style={{ marginTop: 10 }}>{p}</p>
          ))}
        </section>
      ))}
    </div>
  );
}
