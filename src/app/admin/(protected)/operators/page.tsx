import { requirePermission } from "@/lib/admin/require-admin";
import { listOperators, listRoles, operatorsCoverageCount } from "@/lib/admin/operators/list";
import { OperatorRowForm } from "@/components/admin/operator-row-form";
import { QueueHeader } from "@/components/admin/queue-chrome";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";

export const metadata = {
  title: "Operators — Talentrah admin",
  robots: { index: false, follow: false },
};

/**
 * Who can get into /admin, and what they can do there.
 *
 * SUPER ADMINS ONLY, and the guard is on this page rather than in the group
 * layout. The layout's requireAdmin() protects every admin page; this is the
 * one page that needs more, and putting the stricter check where the stricter
 * page is keeps the two from drifting. The nav link is hidden from standard
 * admins as well, but that is presentation — requireSuperAdmin() is the gate,
 * for exactly the reason the proxy's cookie check is not.
 *
 * ACCESS IS DISABLED, NEVER DELETED. admin_audit_log references admin_users,
 * so removing a row would detach an operator from everything they did. That is
 * the same call scripts/grant-admin.ts --revoke already makes, and this screen
 * is deliberately the same operation rather than a second one with different
 * semantics.
 *
 * WHAT IS ABSENT: adding an operator. Granting admin means creating or finding
 * an auth user first, which is grant-admin.ts's job and needs the service-role
 * key. A half-version here — invite by email, say — is a different feature with
 * its own delivery and expiry questions, and a button that only sometimes works
 * is worse than the CLI that always does.
 */
export default async function OperatorsPage() {
  const admin = await requirePermission("operators");
  const [operators, roles, coverage] = await Promise.all([
    listOperators(),
    listRoles(),
    operatorsCoverageCount(),
  ]);

  const active = operators.filter((o) => !o.disabledAt).length;

  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <QueueHeader
        eyebrow="Operators"
        title="Who can get in, and what they can do."
        blurb="A role is a set of permissions; an operator has one role. Only a role granting Operators can reach this page. Disabling keeps the row — the audit log names it — and signs them out immediately."
        adminLabel={admin.displayName || admin.email}
      />

      <BorderedCard className="flex flex-col gap-2 p-5">
        <EyebrowLabel>Status</EyebrowLabel>
        <p className="text-[15px]">
          {active} active of {operators.length} · {roles.length} role
          {roles.length === 1 ? "" : "s"} · {coverage} can manage operators
        </p>
        {/*
          The one sentence that explains a refusal before it happens. The rule
          is enforced in the database, in the same statement that does the
          write; this is here so the refusal reads as a rule rather than a bug.
        */}
        {coverage === 1 && (
          <p className="font-display text-[14.5px] italic text-ink-soft">
            Only one active operator can manage operators, so changing or
            disabling them will be refused. Give someone else a role granting
            Operators first.
          </p>
        )}
      </BorderedCard>

      <ul className="flex list-none flex-col gap-4 p-0">
        {operators.map((o) => (
          <li key={o.id}>
            <BorderedCard className="flex flex-col gap-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex flex-col gap-1.5">
                  <EyebrowLabel>{o.roleName ?? "No role — no access"}</EyebrowLabel>
                  <h2 className="font-display text-[20px] font-semibold leading-snug">
                    {o.displayName || o.email}
                  </h2>
                  {o.displayName && (
                    <p className="text-[13.5px] text-ink-soft">{o.email}</p>
                  )}
                  <p className="text-[13.5px] text-ink-soft">
                    {o.disabledAt
                      ? `Disabled ${new Date(o.disabledAt).toLocaleDateString()}`
                      : "Active"}
                    {" · "}
                    {o.lastLoginAt
                      ? `last signed in ${new Date(o.lastLoginAt).toLocaleDateString()}`
                      : "never signed in"}
                  </p>
                </div>
              </div>

              <OperatorRowForm
                id={o.id}
                roleId={o.roleId}
                roles={roles.map((r) => ({ id: r.id, name: r.name }))}
                disabled={o.disabledAt !== null}
                isSelf={o.id === admin.adminId}
              />
            </BorderedCard>
          </li>
        ))}
      </ul>
    </Container>
  );
}
