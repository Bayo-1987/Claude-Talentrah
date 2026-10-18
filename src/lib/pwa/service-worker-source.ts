/**
 * The two scripts /sw.js can serve, as plain JavaScript text. Kept as strings (not a build step, not a dependency) so the route can answer with
 * them and tests/pwa/service-worker.test.ts can run the REAL text in a fake worker scope.
 *
 * THE WORKER IS A DECISION TABLE, NOT A CACHE. It owns exactly one cache and that cache holds exactly one thing, the /offline page.
 *
 *   a GET navigation, same-origin, not an iframe, not under /api, /billing, /embed or /data-export
 *       -> respondWith(navigation preload if there is one, else fetch). If that REJECTS (no network at all), the cached /offline.
 *          Any HTTP response, 2xx through 5xx, goes back unchanged. NOTHING is stored.
 *   any other navigation (a form POST, /api/*, /billing/*, /embed/*, /data-export/*, an iframe)  -> not intercepted
 *   everything else (scripts, styles, images, fonts, fetch()/XHR, Server Actions, RSC and prefetch, range requests, any cross-origin request)
 *       -> not intercepted
 *
 * "Not intercepted" means the worker never calls respondWith, so the browser handles the request exactly as if no worker existed.
 *
 * DELIBERATE EXTRAS beyond the table's literal wording, each the safer side: the exact paths /api, /billing, /embed and /data-export are
 * passed through as well as their children (a bare "/billing" is a payments page, and "/api" and "/embed" are the prefixes themselves);
 * /apix, /billing-x and /embedded are NOT excluded, because they are different paths.
 *
 * /data-export/* IS PASS-THROUGH because a data-export link is single use: if the worker answered a failed attempt with the offline page, the
 * person would be told to retry a link that is already spent. (The same reason /billing/callback is never intercepted: a return from a
 * payment must reach the server exactly once, untouched.)
 *
 * NOTHING IS STORED, and not because of a rule the script could check: a service worker cannot read Set-Cookie (it is a forbidden response
 * header name), so "never cache a response that sets a cookie" cannot be enforced by looking at headers. It is enforced by never caching a
 * response at all. That also means no stale credits balance, no tracker page surviving a sign-out and nothing to leak between two people on a
 * shared phone: the worker's one cache holds a page that is identical for everyone.
 *
 * AN UPDATE ACTIVATES ON THE NEXT LOAD. The normal worker never takes over a running page, so a half-finished form is not swapped under a
 * person; only the self-destruct worker below does that. It enables navigation preload on activate (so the navigation request starts while the
 * worker boots instead of after it) and claims the open page so the page that registered it is controlled at once.
 *
 * The cache name is versioned. Bump the number to retire the old cache: activate deletes every cache that is not this one.
 */
export const OFFLINE_CACHE_NAME = "talentrah-offline-v1";
export const OFFLINE_URL = "/offline";

/** The prefix every cache this app ever created starts with; the page uses it to delete only its own when the kill switch is on. */
export const CACHE_PREFIX = "talentrah-offline-";

export const WORKER_SOURCE = `"use strict";
// This worker stores NOTHING but the /offline page. It cannot do better: a worker cannot read Set-Cookie (a forbidden response header name),
// so a rule like "never cache a response that sets a cookie" cannot be enforced here. Not caching responses is the enforcement.
var CACHE = ${JSON.stringify(OFFLINE_CACHE_NAME)};
var OFFLINE_URL = ${JSON.stringify(OFFLINE_URL)};
// Paths the worker never answers, exact or as a parent. Matched on whole path segments: /apix and /billing-x are NOT in this list.
var PASS_THROUGH = ["/api", "/billing", "/embed", "/data-export"];

function isPassThroughPath(pathname) {
  for (var i = 0; i < PASS_THROUGH.length; i++) {
    var p = PASS_THROUGH[i];
    if (pathname === p || pathname.indexOf(p + "/") === 0) return true;
  }
  return false;
}

function shouldAnswer(request) {
  if (request.mode !== "navigate") return false;
  if (request.method !== "GET") return false;
  var dest = request.destination;
  if (dest === "iframe" || dest === "frame" || dest === "embed" || dest === "object") return false;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return !isPassThroughPath(url.pathname);
}

self.addEventListener("install", function (event) {
  // Fresh from the network (not the HTTP cache), so a new worker version stores the page it was released with. The only write this script makes.
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    Promise.all([
      caches.keys().then(function (names) {
        return Promise.all(
          names.filter(function (name) { return name !== CACHE; }).map(function (name) { return caches.delete(name); })
        );
      }),
      self.registration.navigationPreload ? self.registration.navigationPreload.enable() : Promise.resolve(),
      self.clients.claim()
    ])
  );
});

self.addEventListener("fetch", function (event) {
  if (!shouldAnswer(event.request)) return;
  event.respondWith(
    Promise.resolve(event.preloadResponse)
      .then(function (preloaded) { return preloaded || fetch(event.request); })
      .catch(function () {
        return caches.open(CACHE)
          .then(function (cache) { return cache.match(OFFLINE_URL); })
          .then(function (page) { return page || Response.error(); });
      })
  );
});
`;

/**
 * The self-destruct worker, served instead of the normal one when PWA_KILL is "1". For a browser that fetches /sw.js during its background
 * update check: it takes over at once, deletes every cache, and unregisters itself. It does NOT reload or navigate any window (no force-reload
 * at all); windows pick up the unregistered state on their next navigation. It has no fetch handler, so while it lives it answers nothing.
 * The page stops registering when the kill switch is on (src/lib/pwa/bootstrap.ts), so nothing reinstalls it.
 */
export const KILL_SOURCE = `"use strict";
self.addEventListener("install", function () {
  self.skipWaiting();
});
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names.map(function (name) { return caches.delete(name); }));
      })
      .then(function () {
        return self.registration.unregister();
      })
  );
});
`;
