# Supabase auth email templates

`confirm-signup.html` is the "Confirm sign up" email for signing up with a six-digit code (S1-101). `confirm-signup.subject.txt` is its subject. Nothing in the app
sends these: Supabase sends them, from the template pasted into **Authentication → Emails → Confirm sign up** in the dashboard. They are kept here so the wording is
reviewed in a diff and pinned by `tests/auth/confirm-signup-template.test.ts`.

- It uses `{{ .Token }}` (the code) and no `{{ .ConfirmationURL }}`: there is no link to click, and nothing for a mail scanner to open.
- "The code expires in 15 minutes" is true only once the project's **Email OTP Expiration** is 900 seconds. That setting covers every email code and link the
  project sends (password reset and operator invitations included), so set it at the same moment as the template.
- The page that takes the code is `/signup/check-email`; links already sent keep working through `/auth/callback`, which this change does not touch.
