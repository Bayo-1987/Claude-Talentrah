## Merged 2026-10-02 — every route under /dev/ answers 404 on the live site, by one layout guard (send-512)

> Entry written inside the PR, before merge. The captain fills in the PR number in the filename and the **Merged at / Merge SHA** row at merge,
> and the production confirmation under Verification 3 after the deploy.

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| (PR number, filled at merge) | `fix/dev-fixtures-closed-512` | (filled at merge) | (filled at merge) |

**What it changed.** `src/app/dev/layout.tsx` calls `notFound()` unless `isDevFixtureAllowed()` (`src/lib/dev/dev-fixture-guard.ts`: false when `VERCEL_ENV === "production"`) and sets
`noindex, nofollow`. One guard on the layout covers every page beneath `/dev/`, so a fixture added later is closed by default. `VERCEL_ENV`, not `NODE_ENV`, because CI runs the
same production build (`NODE_ENV=production`) the fixtures are exercised against. Found while adding the file-input fixture: `/dev/design-check`, `/dev/resume-editor-fixture` and
`/dev/banner-crop-fixture` answered 200 on talentrah.com. `robots.txt` already had `Disallow: /dev/`; a test now pins it.

**Tests.** `tests/dev/dev-fixture-guard.test.ts` (the pure guard, incl. `VERCEL_ENV=production` + `NODE_ENV=production`) and `tests/dev/dev-routes-guarded.test.ts` (the layout guards and
sets noindex; no `route.ts` under `/dev` (a route handler would bypass a layout); no parallel/intercepting route group; the layout answers `NEXT_NOT_FOUND` in production and renders
in CI's build; robots disallows `/dev/`). Tests-first: 9 of the 13 were red before the layout existed.

### Verification
**1. GitHub API:** (filled at merge). **2. Fresh clone:** (filled at merge). **3. Production:** (after deploy) every fixture route must answer 404 on talentrah.com:
`/dev/design-check`, `/dev/resume-editor-fixture`, `/dev/banner-crop-fixture`, `/dev/template-skeletons/<x>`, `/dev/resume-print-fixture/<template>`.
Checked before the PR on a local build with `VERCEL_ENV=production`: all six probes (these five and an unknown path) answered 404; the same build without `VERCEL_ENV` served the first three at 200.
**4. Full suite on merged main:** (filled at merge).

**Flakes and reruns:** none yet (filled at merge if any).

### Not covered / open
- `/dev/job-posting-form-fixture` (#660, not yet merged) is covered automatically by the layout once it lands.
