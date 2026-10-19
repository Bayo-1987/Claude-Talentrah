/**
 * The ONE Referrer-Policy every /data-export response uses: the confirm page, the refusal page, the redirects, the file response, the page's <meta name="referrer"> and the next.config.ts rule for
 * /data-export/:path* (that one is a literal, pinned to this value by tests/data-export/download-headers.test.ts).
 *
 * `same-origin`, not `no-referrer`: the URL carries the export id, so it must never reach another site, and `same-origin` sends nothing cross-origin. But a form POST from a page whose policy is
 * `no-referrer` is sent with `Origin: null` (Fetch spec, "serializing a request origin"), which the POST's same-origin check refuses, so every real click would have got the refusal page. With
 * `same-origin` the browser sends the page's real Origin on the POST. The pages have no link, image or script that leaves the site, so nothing else can leak the URL.
 */
export const REFERRER_POLICY = "same-origin";
