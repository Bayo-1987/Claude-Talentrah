## Merged 2026-10-02 — one hook for the pre-hydration file pick on all six file inputs; the screening gate says what is attached and what was sent (send-513)

> Entry written inside the PR, before merge. The captain fills in the PR number in the filename and the **Merged at / Merge SHA** row at merge,
> and the production confirmation under Verification 3 after the deploy. Stacked on #669 (the `/dev` layout guard): this branch carries no guard of its own.

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| (PR number, filled at merge) | `fix/use-catch-up-file-513` | (filled at merge) | (filled at merge) |

**What it changed.** #663 fixed one input (the banner picker) whose `change` event fired before React hydrated and was never replayed, so the pick vanished. The same pattern was on
every `type="file"` input in `src`. `useCatchUpFile` (`src/lib/forms/use-catch-up-file.ts`, decision in `src/lib/forms/catch-up-file.ts`) is a mount-only effect that reads whatever the
input already holds and hands it to the component's own handler once; it is strict-mode safe and never handles the same file twice. It is on all six: banner crop picker, the new-job and edit-job
assessment pickers, the assessment exercise upload, the screening gate's attachment, and the onboarding resume upload. A test lists every `type="file"` in `src` and fails when one is not in the table.
`src/lib/employer/banner-pick.ts` (the one-off from #663) is replaced by it.

The screening gate (`screening-gate-apply.tsx`) now says what is attached ("Attached: name (size)" / "No file attached"), why Submit is off (one sentence naming every blocker, `aria-describedby`),
and, after sending, what was sent. **That confirmation is read from the stored submission** (`application_assessment_submissions` and its response files, through the candidate's own session client; RLS
"candidate or owning org can read…" already allows exactly that), not from what the browser believes it sent. "Submitted with cv.pdf", "Submitted without an attachment", and nothing at all when no submission row
exists. No schema change.

**Tests.** `tests/forms/catch-up-file.test.ts` (pure decision per input, wiring per input, the table-lists-every-file-input check, mount-only effect), `tests/jobs/screening-gate-copy.test.ts` (wording),
`e2e/file-input-pre-hydration.spec.ts` (hydration stalled on purpose: a programmatic pick and a label-click pick on each input, reload and back/forward do not replay, the screening gate's three states).
**New:** `tests/jobs/stored-submission-rls.test.ts` (DB-backed, runs in CI): a candidate asking for another candidate's application gets nothing (no submission, no wording, no file names, no file rows
directly), their own wording is identical before and after they ask, and the owning organisation can still read. Not runnable locally (no database in this environment); the first CI run is its first run.

### Verification
**1. GitHub API:** (filled at merge). **2. Fresh clone:** (filled at merge). **3. Production:** (filled after deploy). **4. Full suite on merged main:** (filled at merge).

**Flakes and reruns:** none yet (filled at merge if any).

### Not covered / open
- Browsers: Chromium only (a Firefox/WebKit install was declined).
- The RLS test has not been run red against a deliberately broken policy; its negative assertions are on rows the policies must hide, so a permissive policy would fail it, but that has not been shown.
