# Talentrah as an installable app (PWA)

A person can add Talentrah to their phone's home screen from the browser, no app store. This page is the standing reference: what the pieces are, what the
service worker does and **refuses** to do, how to switch it off, and how it is tested. Out of v1, on purpose: push notifications, offline use of signed-in
pages, app-store listings.

## The pieces

| piece | where | what it is |
|---|---|---|
| Manifest | `src/app/manifest.ts` → `/manifest.webmanifest` | `start_url: "/dashboard"` (sends an organisation member to `/employer`, everyone else to `/jobs`, a signed-out visitor to `/login`), `display: standalone`, `id` and `scope` `"/"`, paper colour as hex |
| Icons | `public/icons/talentrah-mark-any-192.png`, `-any-512.png` (manifest `any`), `-apple-180.png` (Apple touch icon), `-maskable-192.png`, `-maskable-512.png` (manifest `maskable`) | all **opaque** (paper behind the mark: iOS draws black behind a transparent Home Screen icon, a launcher draws its own colour behind a transparent `any` icon). Generated once by `scripts/generate-pwa-icons.ts` (`sharp`, already a dependency; not part of the build). The share image `talentrah-mark-512.png` and the 16/32/48 favicons are untouched and pinned by sha256 in `tests/pwa/icons.test.ts`. A maskable icon is a **separate** file with the mark inside the safe zone; one image never serves both purposes |
| Colours | `src/lib/pwa/colors.ts` | `--paper` `oklch(98% 0.004 90)` = `#f9f8f5`. A manifest cannot hold oklch; `tests/pwa/manifest.test.ts` re-derives the hex from `globals.css` and fails if either moves |
| Service worker | `src/lib/pwa/service-worker-source.ts` served by `src/app/sw.js/route.ts` | plain JavaScript text, no dependency, no build step |
| Offline page | `src/lib/pwa/offline-page.ts` served by `src/app/offline/route.ts` | one self-contained HTML string (see below) |
| Bootstrap | `src/lib/pwa/bootstrap.ts`, rendered by the root layout as `PwaBootstrap` | registers the worker, captures the install prompt, honours the kill switch |
| Install strip | `src/components/pwa/install-strip*.tsx`, `src/lib/pwa/install-state.ts` | signed-in app shell only |
| Proxy matcher | `src/proxy.ts` | the three paths skip the proxy |

## What the worker does, and refuses to do

It is a **decision table, not a cache**. It owns one cache (`talentrah-offline-v1`) and that cache holds one thing, `/offline`.

| request | action |
|---|---|
| a `GET` navigation, same-origin, not an iframe, not under `/api`, `/billing`, `/embed` or `/data-export` | answer with the navigation preload response if there is one, else `fetch()`. If that **rejects** (no network at all), answer with the cached `/offline`. Any HTTP response, 2xx to 5xx, goes back unchanged. **Store nothing.** |
| any other navigation (a form POST, those four prefixes, an iframe) | not intercepted (`respondWith` is never called) |
| everything else: scripts, styles, images, fonts, `fetch()`/XHR, Server Actions, RSC and prefetch requests, range requests, every cross-origin request | not intercepted |

Notes that are easy to get wrong:

- **A worker cannot read `Set-Cookie`** (a forbidden response header name), so "never cache a response that sets a cookie" cannot be enforced by looking at headers. It is enforced by never caching a response at all. There is therefore no stale credits balance, no tracker page that survives a sign-out, nothing to leak between two people on a shared phone, and a hashed `/_next` chunk that vanished in a deploy cannot be served from a stale cache.
- **`/data-export/*` is pass-through** because a data-export link is single use: answering a failed attempt with the offline page would tell the person to retry a spent link. For the same reason `/billing/*` (the Paystack return) is never intercepted. Do **not** extend this to `/auth/callback`: an offline attempt there must show the offline page, consume nothing, and complete once on retry (`e2e/pwa-auth-links.spec.ts`).
- The prefixes are matched on whole path segments: `/api`, `/api/x` are excluded; `/apix`, `/billing-x`, `/embedded` are not. The exact paths `/api`, `/embed`, `/billing` are excluded too (a deliberate superset of the original table).
- **No `skipWaiting` in the normal worker**: an update activates on the next load, so a half-finished form is not swapped under a person. The test asserts the script text never contains it. `clients.claim()` runs on activate so the page that registered the worker is controlled at once, and navigation preload is enabled there.
- There is **no static-asset cache**. The HTTP cache already holds `/_next/static/*` and `/icons/*`; a worker cache would add a second copy to keep in step.

## The offline page

`/offline` is a **route handler returning an HTML string**, not a React page. The worker caches it at install and serves it later, possibly after a deploy has deleted the `/_next` chunks a normal page would need. So it has inline CSS and an inline SVG and no external request of any kind (the icon `<link>` is an empty `data:` URL, which the browser never fetches). The retry is a plain `<a href="">`, which resolves to the current document URL: when the worker answered a navigation to `/jobs`, the link re-requests `/jobs`. No JavaScript, so a deploy cannot break it. Type is the system stack (Georgia, Arial), the repo's own fallbacks for Newsreader and IBM Plex Sans.

Cost of precaching one brand font (not done in v1): the preloaded Latin faces are 40 KB (IBM Plex Sans, normal), 58 KB (Newsreader normal) and 65 KB (Newsreader italic) of woff2, so one face adds 40 to 65 KB to every first visit's background install on the metered connections this app targets.

`/offline/` (trailing slash) is answered by Next's own redirect step with a `308` to `/offline` before the proxy runs.

## The install strip

- Android and other Chromium: shown only once `beforeinstallprompt` has been captured; **Install** calls `prompt()` on that event. iOS Safari (iPhone and iPadOS): "To install: tap Share, then Add to Home Screen." Other iOS browsers get nothing.
- Hidden when already standalone, for 30 days after **Not now** (a millisecond timestamp in `localStorage` key `talentrah-install-dismissed`, per browser and origin: it holds across pages, reloads and restarts, not across devices or after site data is cleared; every read and write is in `try/catch`; in a private window or with storage blocked nothing can be stored, so it is remembered only for the life of the page and comes back on the next visit; Safari may also purge script-written storage after a week without a visit), while the cookie banner is open, and, on a phone (under 760px) only, while Farah's first-visit hint is on screen (the hint stands exactly where the bar does; from 760px up it is beside the panel).
- Mounted only in the **signed-in** branch of `AppShell`. Never on a marketing page or for a signed-out visitor. It is a **fixed bar on the bottom edge** (above the Farah tab below 760px), never in flow (the page gets matching padding at its end while it shows: a spacer measured from the bar's real height, so the last content is never hidden under it), because it appears after hydration and an in-flow strip pushed the whole page down when it mounted (e2e checks the content column's offset is identical before and after).
- **Deliberate side effect:** the early bootstrap calls `preventDefault()` on `beforeinstallprompt` on **every** page, so Chrome's own mini-infobar never appears. The browser-menu "Install" still works. Our strip is the only prompt.
- The event is captured by the early bootstrap (not the lazy strip) and kept on `window.__talentrahInstallPrompt`, because the browser can fire it before the lazy component has mounted.

## Kill switch

Set the environment variable **`PWA_KILL=1`** for **both Build and Runtime** in **each Vercel environment you want switched off** (Production, Preview, Development as needed), then **redeploy**. Both are required: the root layout reads it **at build time** (the homepage is statically rendered, so a static read bakes the page-side behaviour in) and the `/sw.js` route reads it **at runtime**. Changing it without a redeploy does nothing, and setting it for Runtime only leaves every static page still registering the worker.

With it on:

- `/sw.js` serves a **self-destruct worker** to a browser doing its own update check: it takes over at once (`skipWaiting`), deletes every cache and unregisters itself. It does **not** reload or navigate any window; windows pick up the unregistered state on their next navigation.
- Pages **only unregister** what exists and delete this app's caches. They **never call `register`**, so nothing reinstalls the worker. (An earlier design reloaded windows while the page kept registering, which would have looped.)
- No install prompt is captured, so the strip cannot appear.

To confirm it worked: in a browser that had the app installed, load any page; `navigator.serviceWorker.getRegistrations()` is `[]` and `caches.keys()` has no `talentrah-offline-*`.

To bring it back: remove the variable (or set it to anything but `1`) for Build and Runtime and redeploy. Only the exact value `1` kills.

A flag with no redeploy would need a feature-flag row (one additive migration); not built.

## Proxy

`/manifest.webmanifest`, `/sw.js` and `/offline` are excluded from `src/proxy.ts`'s matcher, anchored with `$`, so they never run `auth.getUser()`, `last_active_at`, the referral capture or the pending-deletion gate. Without this, `pendingDeletionGate` redirected the manifest and `/offline` for a person inside their deletion window (its exemption allows extensions of 2 to 8 letters and `.webmanifest` is 11; `/offline` has none). Near misses (`/offline-x`, `/offline/x`, `/sw.json`, `/sw.js.map`, `/manifest.webmanifestx`) still run the proxy. `isExemptFromPendingDeletionGate` is unchanged.

## Headers

`/sw.js`: `Content-Type: application/javascript; charset=utf-8`, `Cache-Control: no-cache, no-store, must-revalidate`, `Content-Security-Policy: default-src 'self'; script-src 'self'`; registered with `{ scope: "/", updateViaCache: "none" }` after `load` and idle time so it cannot affect LCP. Registration sets no cookie. The CSP is unchanged: the site policy is report-only and `worker-src` and `manifest-src` fall back to `default-src 'self'`; the future enforcing policy must keep `worker-src 'self'`.

## Tests

- Unit, no database: `tests/pwa/*`, `tests/proxy/pwa-matcher.test.ts` (the matcher is compiled and evaluated with Next's own functions). The worker tests run the **real script text** in a fake worker scope (`tests/pwa/support/worker-harness.ts`).
- e2e (real Chromium, production build): `e2e/pwa-offline`, `pwa-worker-active`, `pwa-auth-links`, `pwa-static-paths`, `pwa-embed`, `pwa-install-strip`; `pwa-kill-switch` needs a build made with `PWA_KILL=1` and skips unless `PWA_KILL_PHASE` is set:

  ```bash
  # 1. normal build and server up
  PWA_KILL_PHASE=install PWA_PROFILE_DIR=/tmp/pwa-profile npx playwright test e2e/pwa-kill-switch.spec.ts
  # 2. stop it; rebuild AND restart with PWA_KILL=1 set for the build and the server
  PWA_KILL_PHASE=killed  PWA_PROFILE_DIR=/tmp/pwa-profile npx playwright test e2e/pwa-kill-switch.spec.ts
  PWA_KILL_PHASE=fresh   npx playwright test e2e/pwa-kill-switch.spec.ts
  ```
- Auth-link specs need a local Supabase stack with email confirmations on; they find the mail catcher at the API port plus 3 (`MAILPIT_URL` overrides) and refuse any non-local host.
- The Google sign-in spec (`e2e/pwa-worker-active.spec.ts`, "(b)") needs a stack whose GoTrue has a Google provider. The repo's `supabase/config.toml` has none, **and must not gain one for a test**, so the spec **skips itself with a stated reason when `/auth/v1/settings` reports `external.google: false`, which is what CI sees; that skip is expected.** To run it, add this to a **scratch copy** of `supabase/config.toml` (not the repo's), under `[auth.external.apple]`'s neighbours, and restart the stack; the values are fake and Google is never contacted (the spec aborts the request to `accounts.google.com`):

  ```toml
  [auth.external.google]
  enabled = true
  client_id = "local-test-client-id.apps.googleusercontent.invalid"
  secret = "local-test-only-not-a-real-secret"
  skip_nonce_check = true
  ```
- Installability: Lighthouse 12.6.1 (the one inside `@lhci/cli@0.15.1`) has no installability audit (its PWA category was removed in 12), so `e2e/pwa-static-paths.spec.ts` asks Chromium directly (`Page.getInstallabilityErrors`, expecting none).
- Latency: `scripts/measure-pwa-latency.ts` (interleaved variants; see its header). A throttled run slows the page but not the worker's own thread.

## Manual checklist on real phones

Not simulated. The results live in the build report (`reports/S4/2026-10-17-pwa-build.md`); the steps are there too.
