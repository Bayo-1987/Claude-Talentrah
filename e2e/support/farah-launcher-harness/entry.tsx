/**
 * The page the launcher spec loads: the REAL FarahSheetHost (launcher, scrim, sheet), the REAL FarahJobMenu, the REAL install strip and the REAL first-visit hint, in the same wrapper structure
 * as src/components/app-shell/app-shell.tsx, with the app's real compiled stylesheet. Only next/link, next/navigation and the hint's Server Action are stubbed (see build.ts), and the Farah
 * PANEL is a stand-in: a tall conversation with a composer and a place that reacts to a job being handed over the way the real panel does (it moves focus to the first option, which only works
 * if the panel is visible). No app server and no database are needed. The real panel is covered by the CI e2e specs that sign in.
 */
import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { Masthead } from "@/components/app-shell/masthead";
import { FarahSheetHost } from "@/components/app-shell/farah-sheet-host";
import { FarahJobMenu } from "@/components/jobs/farah-job-menu";
import { FarahFirstVisitHint } from "@/components/app-shell/farah-first-visit-hint";
import InstallStrip from "@/components/pwa/install-strip";
import { onFarahJobSeed, type FarahJobSeed } from "@/lib/farah/job-seed";
import { scrollToFarahPanel } from "@/lib/farah/scroll-to-panel";

interface Options {
  unread?: boolean;
  hint?: boolean;
  strip?: boolean;
}
declare global {
  interface Window {
    __mountLauncher: (options: Options) => void;
    __pathname?: string;
    __focusLanded: boolean | null;
    __hintDismissals: number;
    __mountHeader: (props: Record<string, unknown>) => void;
    __signOuts: number;
    __switched: string[];
    __navigated: string[];
  }
}
window.__focusLanded = null;
window.__hintDismissals = 0;
window.__signOuts = 0;
window.__switched = [];
window.__navigated = [];

function StubPanel() {
  const [job, setJob] = useState<FarahJobSeed | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => onFarahJobSeed((seed) => setJob(seed)), []);
  useEffect(() => {
    if (!job) return;
    // What the real panel does on arrival (job-seed-arrival.ts, revealJobBlock): focus the first option. It cannot land on a hidden element.
    const option = ref.current?.querySelector<HTMLElement>("[data-job-option]");
    option?.focus({ preventScroll: true });
    window.__focusLanded = !!option && document.activeElement === option;
  }, [job]);
  return (
    <div ref={ref} data-testid="farah-panel" data-marker="" className="flex w-full flex-col gap-5 border-t-[3px] border-t-rust px-6 py-8 min-[760px]:sticky min-[760px]:top-[68px] min-[760px]:w-[280px] min-[760px]:flex-shrink-0 min-[760px]:px-7">
      <p className="font-display text-[20px]">Hi Sam, I&apos;m Farah.</p>
      {Array.from({ length: 14 }, (_, i) => (
        <p key={i} className="text-[14px] text-ink-soft">
          A line of the conversation, number {i + 1}.
        </p>
      ))}
      {job && (
        <div data-testid="job-seed-block">
          <p>
            Farah has {job.jobTitle} at {job.companyName}.
          </p>
          <button type="button" data-job-option className="min-h-10 border border-ink px-3">
            Am I a fit?
          </button>
        </div>
      )}
      <textarea aria-label="Message Farah" rows={2} className="w-full border border-ink p-2" />
    </div>
  );
}

function Page({ options }: { options: Options }) {
  return (
    <div className="min-h-screen">
      <div data-testid="masthead-band" className="sticky top-0 z-20 border-b border-line bg-paper px-6 py-4">
        <button type="button" data-testid="masthead-ask-farah" className="min-h-10 font-semibold" onClick={() => scrollToFarahPanel()}>
          Ask Farah
        </button>
      </div>
      <main id="main-content" className="mx-auto flex w-full max-w-[1360px] flex-col min-[760px]:flex-row print:block print:max-w-none">
        <div data-testid="content-column" className="min-w-0 flex-1 px-6 py-8 min-[760px]:px-10 print:p-0">
          <input aria-label="Search jobs" className="mb-6 w-full border border-ink p-2" />
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="mb-6 flex flex-col gap-3.5 border-[1.5px] border-ink bg-card p-5">
              <p className="font-display text-[19px]">Job number {i + 1}</p>
              <p className="text-[14px] text-ink-soft">A short description that fills out the card a little so that the page is tall enough to scroll.</p>
              <div data-testid="job-card-actions" data-farah-avoid="true" className="relative flex flex-wrap items-center justify-end gap-2.5 max-[760px]:pr-[72px] min-[760px]:flex-nowrap">
                <button type="button" className="h-10 w-10 border border-ink">S</button>
                <FarahJobMenu jobId={`job-${i + 1}`} jobTitle={`Job number ${i + 1}`} companyName="Acme" />
                <a href="#apply" data-testid={`apply-${i + 1}`} className="inline-flex min-h-10 items-center border-none bg-ink px-[18px] py-[10px] font-body text-[13.5px] font-semibold text-paper">
                  Apply on company site
                </a>
              </div>
            </div>
          ))}
        </div>
        <FarahSheetHost hasUnreadNotification={!!options.unread}>
          <StubPanel />
        </FarahSheetHost>
      </main>
      {options.strip && <InstallStrip />}
      {options.hint && <FarahFirstVisitHint />}
    </div>
  );
}

window.__mountLauncher = (options) => {
  const el = document.getElementById("root");
  if (!el) throw new Error("no root");
  createRoot(el).render(<Page options={options} />);
};

/**
 * The REAL seeker Masthead (with its account menu and the side-switch item, from main) and the REAL FarahSheetHost together, in the shell's own wrapper structure: what a signed-in phone shows.
 * Mounted with the props the app shell passes; used by the "launcher and side switch in one header" spec.
 */
function HeaderPage({ props }: { props: Record<string, unknown> }) {
  const MastheadAny = Masthead as unknown as (p: Record<string, unknown>) => React.ReactNode;
  return (
    <div className="min-h-screen">
      <div data-testid="masthead-band" className="sticky top-0 z-20 print:hidden">
        <MastheadAny {...props} />
      </div>
      <main id="main-content" className="mx-auto flex w-full max-w-[1360px] flex-col min-[760px]:flex-row">
        <div data-testid="content-column" className="min-w-0 flex-1 px-6 py-8 min-[760px]:px-10">
          <p>The page.</p>
        </div>
        <FarahSheetHost hasUnreadNotification={false}>
          <StubPanel />
        </FarahSheetHost>
      </main>
    </div>
  );
}
window.__mountHeader = (props) => {
  const el = document.getElementById("root");
  if (!el) throw new Error("no root");
  createRoot(el).render(<HeaderPage props={props} />);
};
