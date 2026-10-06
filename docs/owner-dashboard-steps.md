# Owner dashboard steps

Some settings live only in a console the repo cannot change. A pull request can merge and deploy and still change nothing for a user, because the setting it
depends on has not been made. This page is the rule for those settings.

## The rule

**Any change that depends on a dashboard-only setting states the exact owner step, and is not done until the owner confirms it is live.** The owner dashboard step
is written in the PR, before it merges: which setting or template, where in the dashboard it is, and the exact value (the text to paste, or the number). A session
does not make the change in a console itself, and does not call the work finished because the code merged.

## What counts as dashboard-only

- **Supabase (the hosted project):** the auth and email templates and their subjects, Email OTP Expiration, redirect URLs and the Site URL, SMTP and the sender, auth
  and email rate limits, and any other setting under Authentication or Project Settings. (`supabase/config.toml` is read by `supabase start` for local development only;
  nothing pushes it to the hosted project.)
- **Vercel:** environment variables for Production and Preview, domains, and deployment settings.
- **Provider consoles:** the settings in each provider's own console, for example payments (Paystack), email delivery (Resend), the LLM providers (Groq, Gemini),
  and OAuth app settings.

A database migration is not on this list: it has its own order and approvals (`docs/database-environments.md`).

## What the written step contains

1. **What:** the setting or template, by the name the dashboard shows.
2. **Where:** the screen, as a path (for example Authentication → Emails → Confirm sign up).
3. **The exact value:** the text, or "paste the whole file `<path>`", or the number with its unit.
4. **How the owner sees it is live:** the observable result (a fresh sign-up receives the new email; the page shows the new value).
5. **Where it is recorded:** the PR body, and for a session's work a line in `approvals/log.md`.

## Done means confirmed live

The PR's own status is "not live" until the owner confirms. The confirmation is dated and recorded where the step is recorded. A standing record is kept for each
family once it exists: the auth emails keep one in `docs/auth-email-templates/README.md` (a table, one row per template file and setting, with a "Live since" date;
`tests/auth/auth-email-dashboard-steps.test.ts` fails if a template has no row).

## Every PR asks

`docs/pull_request_template.md` puts one line on every pull request: "Needs an owner dashboard step: yes / no. If yes, which." Answer it even when the answer is no.
`tests/docs/owner-dashboard-steps.test.ts` keeps this page, that line and the auth-email table wired together.
