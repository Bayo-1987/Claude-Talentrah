/**
 * The ONE Referrer-Policy every /data-export response uses: the confirm page, the refusal page, the redirects, the file response, the page's <meta name="referrer"> and the next.config.ts rule for
 * /data-export/:path* (that one is a literal, pinned to this value by tests/data-export/download-headers.test.ts).
 *
 * `strict-origin`, not `no-referrer`: the URL carries the export id, so no Referer may ever carry it, not even to our own pages (the `/contact` link on the confirm page): `strict-origin` sends at most
 * the bare origin (scheme, host, port; no path), and nothing at all on a downgrade to http. But a form POST from a page whose policy is
 * `no-referrer` is sent with `Origin: null` (Fetch spec, "serializing a request origin"), which the POST's same-origin check refuses, so every real click would have got the refusal page. With
 * `strict-origin` the browser sends the page's real Origin on the POST (and a Referer with no path). The pages have no link, image or script that leaves the site, and the one link on them goes to /contact.
 */
export const REFERRER_POLICY = "strict-origin";
