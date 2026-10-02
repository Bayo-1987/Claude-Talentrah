# Database environments and the migration rules

Written so that no session works without these again. **Where this file and older prose disagree** (CLAUDE.md still describes
the earlier hosted CI project, and `supabase/migrations/README.md` carried an applied-migrations table that stopped years of
work ago), **this file is the newer statement.** The rule about *when* an additive or destructive migration is applied relative to
the merge is unchanged and lives in [production-migration-apply.md](production-migration-apply.md); this file says *where*, *in what
order*, *who reserves the number* and *what is recorded*.

## 1. The three environments

| Environment | What it is | Who uses it |
|---|---|---|
| **production** | project `nytwbbzfpytctjsoczzq`. The real users and the real data. Its ledger, `supabase_migrations.schema_migrations`, is the source of truth for what has been applied anywhere. | the live site only. Sessions read it with `READ ONLY` transactions and write to it only with the owner's yes, see §3. |
| **talentrah-preview** | project `gtiksnbhnqmwpeckfqwk`, in its own organisation (`Talentrah Infra`) so it can never share a billing quota with production. | **Vercel previews and local runs only.** Nothing else reads it. |
| **CI** | a fresh local Supabase built from `supabase/migrations/` on every run (`.github/actions/local-supabase`), per job, thrown away with the runner. | GitHub Actions only. It touches neither of the hosted projects. |

A green CI run therefore says nothing about whether a migration has been applied to production or to talentrah-preview. Check each.

## 2. Reserved migration numbers

**A number is reserved by asking the owner first.** Reading the directory and taking the next free number is not a reservation: `0060` was claimed twice in
one morning by two sessions that each did exactly that. Ask, wait for the number, then write the file.

| Number | Held by | State |
|---|---|---|
| 0208 | S1 | applied |
| 0209 | S3-21 | applied |
| 0210 | S3-21, the `search_path` pin | reserved |
| 0211 onward | S3-21's account-deletion PRs | reserved |

(0205 to 0207 belong to the open draft PRs #661 and #662, and are not in the directory until those merge.) When a number is released or used, change this table in the PR that
uses it. `tests/docs/database-environments.test.ts` fails if this heading or the table is deleted.

## 3. The order for a migration

1. **Production first.** A rolled-back dry run (`BEGIN … ROLLBACK`, with its own self-checks) is shown to the owner. **Then the owner's yes.** Then a **hash-checked apply**
   in one transaction with self-checks: the SQL applied is the SQL in the PR, proven by comparing a hash of it with the file's.
2. **Then talentrah-preview, by the same session that applied to production**, recorded **with a timestamp and the hash** in the PR that carries the migration.
3. **Nothing unmerged goes to talentrah-preview.** Preview runs the code of whatever branch Vercel is building, so a migration that exists only on an unmerged branch
   makes every other branch's preview disagree with its own schema.

Additive migrations go to production before the merge and destructive ones after the deploy (see production-migration-apply.md); this section does not change that.

## 4. One-off production data fixes are not migrations

A fix that edits specific production rows lives in `supabase/data-fixes/`, with a record in that directory's README. It takes no migration number, is not replayed by CI,
and follows the dry-run-then-owner's-yes rule in that README.

## 5. Known history on talentrah-preview

Recorded because a database state that no artifact explains is what this file exists to prevent. Checked against the preview ledger.

- The row **`0208_mentor_unpaid_hold_search_path`** (applied 10:20Z on 2 Oct) was an ad-hoc apply from before these rules. It is **superseded by 0210**; no migration file carries
  that name.
- **0205, 0206 and 0207 were applied to preview before their PRs merged**, also from before the rule. (0207 is recorded there as `job_expiry_reminders`, without its number prefix.)
- Some older rows are recorded without their number prefix (for example `job_posting_supersession` for 0202). The drift check in `scripts/check-migration-drift.ts` is what reconciles
  names; do not rename ledger rows by hand.

Preview and production are **allowed to differ**, in both directions, while a PR is in review. Neither is a copy of the other, and preview has never been the source of truth for anything.
