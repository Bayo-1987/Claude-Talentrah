# Admin-produced data export

An admin, on a support request, produces a copy of ONE person's data. There is **no self-service**: a person cannot start an export (the only page they ever see is the one-button confirm page for a file support has already produced; see *The download*). This file is the whole picture; the
decisions behind it are the owner's, 17-18 Oct 2026, and the open questions for the owner's data-protection adviser are at the end (none of them gates anything here).

## What happens, in order

1. **An admin with the `data_export` permission** (granted to nobody by default, migration 0262) opens the person under *Admin > People lookup* and fills three fields: the support **ticket
   reference** (letters, digits, dot, dash; checked by pattern), a **reason** and **how the requester was checked** (both pick-lists; the owner's rule is the signed-in contact form where
   possible, otherwise a reply from the registered address). The form posts to `POST /admin/data-export`, a route handler with its **own** guard (`getAdmin()`, never the seeker session): no
   identity answers 401; an identity without the permission answers 403 **and writes `people.export_denied`**.
2. **A strict audit row `people.export_requested`** is written *before anything is read*. If it cannot be written, nothing is read and the answer is a generic 503 (fail closed).
3. **Target checks.** The target must be a uuid; not the admin's own account; a person with a profile row; and not an admin account that shares the acting admin's address. A person inside the
   30 days before a scheduled deletion **is** allowed. Every refusal ends in one final strict row (see *Audit* below).
4. **The attempt is claimed in one statement** (the table is `data_export_files`, one row per export; the partial unique index allows one *live* export per person).
   * no live row: an `INSERT` (the unique index decides a race: the loser is refused `in_progress`);
   * a live `generating` row older than 15 minutes: handed to a new attempt by `swap_stale_data_export_attempt()` (one conditional `UPDATE` in SQL; the loser is refused `in_progress`; the winner
     deletes the old attempt's object and audits `people.export_deleted` with reason `cancelled`);
   * a live `generating` row younger than 15 minutes: refused `in_progress`;
   * a live `generated` export nobody has opened: refused **`live_export_exists`** (see *Cancelling an unused export*); one past its 72 hours is cleared first.
5. **The notice email** goes to the registered address *before a table is read*: no data, no link. **It fails closed**: if it cannot be sent, the attempt is marked `failed`, nothing is generated,
   and `notice_failed` is audited. The claim comes first so two admins starting together cannot each send a notice.
6. **The file is generated** (`src/lib/account-export/`, reused from the abandoned self-service branch), uploaded to the **private** `data-exports` bucket at `<export id>/<attempt id>.json`.
7. **The finish** is one conditional `UPDATE` for the attempt that still owns the row (`finish_data_export_attempt`). Zero rows means that attempt was cancelled while it ran: it deletes its own
   object and sends **no** link. Otherwise the row becomes `generated` with `expires_at = now() + 72 hours`.
8. **Strict audit row `people.export_generated`** (counts only), then the **link email** (a second, short email with `/data-export/<id>`; it names no data). If either fails the export is taken
   back so a retry can start at once.
9. **The final row `people.export_finished`** with `outcome: "completed"`.

## The download (`/data-export/<id>`: GET shows a page, POST claims)

The only thing a person touches. The link in the email is `GET /data-export/<id>`; it opens a **confirm page**, and only pressing its **Download my data** button (a form `POST` to the same path) claims
the file. One route handler (`src/app/data-export/[id]/route.ts`) serves both, and the HTML comes straight from it (`src/lib/data-export/pages.ts`), not through the app layout: no install strip, no
service-worker registration, no analytics; the confirm page's only script is the few inline lines that disable the button on submit, and the refusal page has none.

**Why two methods (the evidence, 18-19 Oct).** When the link itself claimed and streamed, every click produced TWO GETs 1 to 1.5 s apart from the same browser (Vercel logs of both exports): the first
answered 200 and streamed to completion, the second began while it was still streaming and was refused as already used. Why a second GET exists is not proven (a browser extension that re-fetches a
download is the leading suspect); whatever the cause, a link that spends itself on the first GET is fragile against any client that fetches twice. Now a GET is read-only and safe to repeat.

* **GET** claims nothing, deletes nothing and writes no audit row, with one exception kept as it was: a signed-in account that is **not** the owner gets the refusal and a `people.export_denied` row
  (one row per such GET, pinned by a test; the growth on repeated GETs is a separate follow-up). The confirm page appears only when the claim *would* succeed (owner, generated, unclaimed, undeleted,
  unexpired); that check is advisory and the POST's claim is the only authority. Everything else gets the generic refusal (404, the same sentence as before, now as a small page), and **the body for
  another account's id is byte-identical to the body for an id that does not exist**. Signed out: to `/login` with the return trip (the status is a 302).
* **POST** is the old path, unchanged in behaviour: session, `claim_data_export_download(export id, user id)` (**one conditional `UPDATE`**: owner, generated, unclaimed, undeleted, unexpired), the
  file streamed with the service role (**not** a signed URL), the object deleted and the row marked `deleted` in a `finally` whether the stream finished, failed or the client dropped, the same two audit
  rows, the same refusal. **A failed download consumes the single use**; support starts a new export, which is allowed straight away. Signed out: **303** to `/login` with the return trip (so the browser
  follows with a GET to the confirm page, never a replayed POST).
* **Same-origin rule on the POST** (`src/lib/data-export/origin.ts`): the `Origin` header (or, when there is none, the `Referer`) must name the host the request arrived on (the `Host` header), **host and
  port, case-insensitively, never a hard-coded domain**, so a preview host and production both work. `Origin: null`, a foreign host, a different port, or neither header: the generic refusal and nothing is
  claimed. `x-forwarded-host` is not read. The session cookie is SameSite=lax, so a cross-site POST carries no session anyway; this is the second layer.
* **The button is disabled on submit** so a double-click sends one POST; with scripts off the plain form still works. The atomic claim makes a second POST a refusal either way.
* **HEAD and OPTIONS** are explicit handlers that answer empty and **never touch the database**. The bundled Next docs do not say what HEAD does when only GET is exported, so the rule is the explicit
  handler; `tests/data-export/download-confirm.test.ts` and `tests/data-export/download.test.ts` record what each method does. A request that carries a prefetch signal (`Sec-Purpose: prefetch`,
  `Purpose: prefetch`, `Next-Router-Prefetch`, `X-Middleware-Prefetch`) also answers empty without reading anything.
* **Headers.** Every response carries `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`; everything under `/data-export` carries ONE `Referrer-Policy: strict-origin` (the URL holds the export id, so no Referer ever carries it, not even to our own `/contact` link; at most the bare origin is sent):
  the handler's pages, redirects and file response, the pages' `<meta name="referrer">` and a rule in `next.config.ts` that comes after the site-wide one; the value is `src/lib/data-export/referrer-policy.ts`.
  It is `strict-origin` and NOT `no-referrer` because a form POST from a `no-referrer` page is sent with `Origin: null`, which the POST's same-origin check refuses, so every real click would have got the refusal page
  (`e2e/data-export-origin.spec.ts` proves it in a real browser). The site's Content-Security-Policy is **Report-Only** and sets no `form-action` (which does not fall back to
  `default-src`), so the same-origin form post and the inline script are allowed; `tests/data-export/download-headers.test.ts` prints the policy it read.
* **Counts-only log lines** in the POST path, so a test can be read from the platform logs without any identifier: `[data-export] claimed`, or `[data-export] refusal class=` one of `origin_refused` (the same-origin check refused the POST: a foreign or
  `null` Origin, no Origin and no Referer, or another port), `claim_error`, `not_claimable`, `denied`, `object_unreadable`. Never an id, an address or an error text; the GET writes none.
* The route is exempt from the pending-deletion gate (`src/lib/auth/pending-deletion-gate.ts`): a person in their 30 days can open it.
* **Residual risk design A does not remove:** a client that makes a duplicate POST, or an extension that intercepts the POST's attachment and loses it, still burns the single use. That is why a preview test
  in the owner's own Chrome comes before any production export.
* Tests: `tests/data-export/download-confirm.test.ts` (GET), `download-post.test.ts` (POST and log lines), `download-origin.test.ts` (same-origin), `download-origin-log.test.ts` (the `origin_refused` line), `referrer-policy.test.ts` (the one Referrer-Policy everywhere), `download-headers.test.ts` (CSP, Referrer-Policy,
  minimal pages, email text), `e2e/data-export-double-click.spec.ts` (one POST on a double-click, in a real browser), `e2e/data-export-origin.spec.ts` (the Origin the browser really sends on the POST), and the database-backed `download.test.ts` (the claim, the stream failures, the cleanup).

## Cancelling an unused export

If the link email is lost, support must not wait up to 72 hours. **Cancel an unused export** (same permission, same guards, needs only the ticket reference) is one conditional `UPDATE`
(`cancel_unused_data_export`: `generated` and `claimed_at IS NULL` becomes `cancelled`). It deletes the object, audits `people.export_cancelled`, **does not email the person** (it exposes no data and
they did not ask for it), and frees the one-live-export slot at once. Anything already opened, expired, deleted, cancelled or never generated is refused `not_cancellable`. A failed delete is retried by
the sweep's bucket pass (a cancelled row is not live, so its object is an orphan there).

## The sweep, and why the bucket needs one

The state row cascades when an account is deleted. **The bucket object does not.** A person who deletes their account (or is purged) inside the 72 hours leaves their data in the bucket with no row pointing
at it, and a sweep that only walked rows would never find it. So `GET /api/admin/sweep-data-exports` (behind `requireCronSecret`; counts only in the response) runs two passes, hourly, from
`.github/workflows/sweep-data-exports-hourly.yml`:

1. **Rows.** Every `generating` row older than 15 minutes becomes `failed` and its attempt's object is removed. Every `generated` row past `expires_at`, every `downloaded` row whose delete never finished
   (claimed more than ten minutes ago, still no `deleted_at`) and every `failed` row not yet cleaned has its object removed and its row marked. A removal that fails leaves the row, counts an alert, and is
   retried next run.
2. **The whole bucket.** Pages the listing until it is exhausted (one list call is one page), folder by folder, and deletes every object without a live row. *Live* = a row for that export id whose
   **current attempt id equals the object's**, and which is `generating`, or `generated` and not expired, or claimed in the last ten minutes. A name that is not `<uuid>/<uuid>.json` is deleted too.

It is safe to delete from the bucket because the start flow claims its row **first** and uploads **second**, to a path made of the two ids: every object has a matching live row from the moment it exists, and
a late upload from a cancelled attempt carries an attempt id nothing owns any more.

* **Why the workflow is on GitHub and not in `vercel.json`:** nothing here depends on the Vercel plan's cron limits. Stated risk, not a reopened decision: there is no daily Vercel backstop, a scheduled
  GitHub workflow is best-effort, and GitHub disables scheduled workflows in a repository with no pushes for 60 days. Access still ends at exactly 72 hours (the claim checks `expires_at`); only the *deletion
  of the bytes* depends on the sweep. To limit the gap, an expired object is also deleted when its expired link is opened and when a new export starts for that person.
* **The secret is `CRON_SECRET`**, the existing repository secret `ingest-jobs-3hourly.yml` already uses and the route reads as `process.env.CRON_SECRET`. This work sets, rotates and creates nothing.
* The workflow reports a non-zero `alerts` count as a failed run.

## `maxDuration` is 300, as a literal

The admin start route and the sweep route each export `export const maxDuration = 300;` as a literal (Next reads it statically). 300 s is the Hobby maximum and is valid on every plan; the project is on Pro
now, but a literal 300 is what the repo pins (see the ingest route's comment). `tests/data-export/max-duration.test.ts` pins both literals and that this section exists.

**What generation does, and what happens at the limit.** It reads the person's tables one at a time, a page at a time (`src/lib/account-export/build.ts`), and **aborts on a table it cannot read**: a person
never receives a file that quietly lacks a table. The pieces are held in memory and uploaded as one object (the bucket's limit is 50 MiB). When the limit is hit, or any step throws: the attempt becomes
`failed`, any object it wrote is removed (and the sweep removes it if that fails), `people.export_finished` records `outcome: "failed"` with the error's class, and **a new export can start at once**.

## Audit

`admin_audit_log.action` is `text` (0060), so none of these needs a migration, and **no CHECK or enum is added for them**. The list is exactly this, pinned by a test:

| action | written by | when |
|---|---|---|
| `people.export_requested` | the admin (strict) | before anything is read; carries the ticket, reason and requester check, and the target uuid only if it is one |
| `people.export_notice_sent` | the admin | the start notice was sent |
| `people.export_generated` | the admin (strict) | the file exists; counts only (tables, rows, bytes) |
| `people.export_downloaded` | `system-data-export@talentrah.internal` | the owner's claim won and the file was handed over |
| `people.export_deleted` | the system actor (or the admin, for the cancellation their own action caused) | an object was deleted; `reason` is `downloaded`, `expired`, `failed`, `stream_failed`, `orphan` or `cancelled` |
| `people.export_denied` | the admin without the permission, or the system for a wrong-account link | a refused caller |
| `people.export_cancelled` | the admin (strict) | support cancelled an unused export |
| `people.export_finished` | the admin (strict) | the last row of every start or cancel: `outcome` is `completed`, `failed`, `refused`, `superseded` or `cancelled` |

**Every refused start (or cancel) after the caller was authorised ends in ONE final `people.export_finished` row with `outcome: "refused"` and a `refusal_code` from this fixed list:** `in_progress`,
`live_export_exists`, `own_account`, `admin_target_needs_other_admin`, `no_such_person`, `not_a_uuid`, `notice_failed`, `not_cancellable`. So no `people.export_requested` row is ever left without an outcome.
A caller *without* the permission is not "refused after authorisation": that is `people.export_denied`. The one case that cannot be audited by definition is the audit writer being unavailable: that path
reads nothing, writes nothing, answers a generic 503 and logs to the server console only.

**No row holds personal content.** Only the target's uuid, the admin's identity, counts and short codes. The ticket is validated by pattern; the reason and requester check are pick-lists; an error is its
class name, never its message. **A target that is not a valid uuid is never copied into a row** (an admin could have pasted an email address): such a row has a null target. A malformed *form* (a ticket that
fails the pattern, a reason not on the list) is a 400 and writes nothing, because no start was attempted and the ticket field in particular must not be copied into a log kept for three years.
Retention of the audit is three years (the owner's decision).

## What is in the file

`src/lib/account-export/manifest.ts` classifies every column of every table, checked against the generated types and `docs/account-deletion-map.md` by `tests/lib/account-export/manifest.test.ts`:
the person's own data and what is about them; **other people appear only as a role or a first name**, never with contact details or ids; **bank details are masked** (bank name and last four digits);
secrets and tokens never; uploaded files are not in this version (the README in the file says so and how to ask). Adding a column or a foreign key into a person fails that test until somebody decides.

## Open questions for the owner's data-protection adviser (a note for later, not a gate)

1. The NDPA response deadline for access requests. 2. Whether the mask, the uploads gap and the cut of other people's data satisfy the right of access. 3. Audit retention (three years is the decision in force).
