# Supabase auth email templates

`confirm-signup.html` is the "Confirm sign up" email for signing up with a six-digit code (S1-101). `confirm-signup.subject.txt` is its subject. Nothing in the app
sends these: Supabase sends them, from the template pasted into **Authentication → Emails → Confirm sign up** in the dashboard. They are kept here so the wording is
reviewed in a diff and pinned by `tests/auth/confirm-signup-template.test.ts`.

- It uses `{{ .Token }}` (the code) and no `{{ .ConfirmationURL }}`: there is no link to click, and nothing for a mail scanner to open.
- "The code expires in 15 minutes" is true only once the project's **Email OTP Expiration** is 900 seconds. That setting covers every email code and link the
  project sends (password reset and operator invitations included), so set it at the same moment as the template.
- The page that takes the code is `/signup/check-email`; links already sent keep working through `/auth/callback`, which this change does not touch.

## Go-live rule

This is the auth-email case of the general rule in `docs/owner-dashboard-steps.md`, which covers every dashboard-only setting (Supabase, Vercel environment variables, provider consoles).

Supabase sends the auth emails from the template and settings the owner puts in the dashboard, so a change in this repo reaches no user until the owner does that
step. Therefore: **any change to an auth email ships with a written owner dashboard step (which template, which setting, the exact value), and the change is not
done until the owner confirms it is live.** An auth email change is any change to a template file or its subject here, or to a project setting that changes what
the email says or whether it works (Email OTP Expiration, the sender, redirect URLs).

- **The step is written in the PR** and kept as a row in the table below: the file or setting, the dashboard location (Authentication → Emails → the template, or the
  setting's screen), the exact value (the subject text, or "paste the whole file", or the number), and "Live since".
- **Live since** is the date the owner confirmed it is live (a fresh sign-up or a test send shows the new email), or the words `not live`. A row that says `not live`
  means the PR is not done. The confirmation is recorded in the PR and, for a session's work, in `approvals/log.md`.
- **A new template file needs its row in the same PR.** `tests/auth/auth-email-dashboard-steps.test.ts` fails if a template file here has no row, if a subject row's
  exact value differs from its `.subject.txt`, if a row has no location, value or live-since, or if the Email OTP Expiration row stops saying 900 seconds.
- `supabase/templates/*.html` are the LOCAL-DEV templates read by `supabase start` (see `supabase/config.toml`); nothing pushes them to the hosted project, so they are
  not a go-live step and are not in this table.

## Dashboard steps

Project `nytwbbzfpytctjsoczzq` (production). One row per file or setting.

| File | Dashboard step | Exact value | Live since |
|---|---|---|---|
| `confirm-signup.html` | Authentication → Emails → Confirm sign up → Message body: replace it with the whole file | the contents of `confirm-signup.html` | 6 Oct 2026 (owner replaced it; a fresh sign-up received a six-digit code and the logo rendered) |
| `confirm-signup.subject.txt` | Authentication → Emails → Confirm sign up → Subject | `Confirm your Talentrah email address` | 6 Oct 2026 (the same owner step) |
| Email OTP Expiration (setting) | Authentication, the email provider's settings: Email OTP Expiration (the owner set it on the screen it lives on; the exact screen name is not recorded here) | `900` seconds | 6 Oct 2026 (owner set it; logged in `approvals/log.md`) |
