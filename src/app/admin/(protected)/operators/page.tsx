import { requirePermission } from "@/lib/admin/require-admin";
import { listOperators, listRoles, listPermissions, operatorsCoverageCount } from "@/lib/admin/operators/list";
import { OperatorRowForm } from "@/components/admin/operator-row-form";
import { InviteOperatorForm } from "@/components/admin/invite-operator-form";
import { RoleEditor } from "@/components/admin/role-editor";
import { QueueHeader } from "@/components/admin/queue-chrome";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";

/**
 * Labels for the permission keys. The KEYS come from the database.
 *
 * A hardcoded catalog beside a migration-extensible enum is guaranteed to
 * drift, and the failure is silent AND destructive: admin_upsert_role replaces
 * a role's permission set with exactly what the form submitted, so a
 * permission the checkboxes do not offer is deleted from every role somebody
 * saves. That was live — `blog` was added by a later migration and granted to
 * both builtin roles, and this screen would have stripped it from any role an
 * operator edited, including Super Admin.
 *
 * So the list is read from admin_permission_catalog() (0079) and anything
 * without a label here still renders, humanised, rather than vanishing.
 */
const PERMISSION_LABELS: Record<string, string> = {
  scholarships: "Scholarships",
  reported_postings: "Reported postings",
  ad_campaigns: "Ad campaigns",
  feedback: "Feedback",
  courses: "Courses",
  operations: "Operations",
  finance: "Finance",
  people: "People (support lookup)",
  blog: "Blog",
  operators: "Operators — manage roles and operators",
};

function labelFor(key: string): string {
  return PERMISSION_LABELS[key] ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

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
 * INVITING IS HERE NOW, and grant-admin.ts stays anyway. The CLI is the
 * bootstrap and break-glass path: reaching this page requires already being an
 * operator, so with zero admins — or with every admin locked out — the script
 * is the only way back in. Two paths to the same table, for two different
 * situations.
 */
export default async function OperatorsPage() {
  const admin = await requirePermission("operators");
  const [operators, roles, permissionKeys, coverage] = await Promise.all([
    listOperators(),
    listRoles(),
    listPermissions(),
    operatorsCoverageCount(),
  ]);
  const permissionOptions = permissionKeys.map((key) => ({ key, label: labelFor(key) }));

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

      {/* ── invite ────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <EyebrowLabel>Invite an operator</EyebrowLabel>
        <BorderedCard className="p-5">
          <InviteOperatorForm roles={roles.map((r) => ({ id: r.id, name: r.name }))} />
        </BorderedCard>
      </section>

      {/* ── roles ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <EyebrowLabel>Roles</EyebrowLabel>
        <p className="max-w-[640px] font-display text-[14.5px] italic text-ink-soft">
          A role is a set of permissions. Removing Operators from the last role
          that grants it, or deleting that role, is refused — otherwise nobody
          could reach this page to undo it.
        </p>
        <ul className="flex list-none flex-col gap-4 p-0">
          {roles.map((r) => (
            <li key={r.id}>
              <BorderedCard className="p-5">
                <RoleEditor
                  role={{
                    id: r.id,
                    name: r.name,
                    isBuiltin: r.isBuiltin,
                    permissions: r.permissions,
                  }}
                  allPermissions={permissionOptions}
                />
              </BorderedCard>
            </li>
          ))}
          <li>
            <BorderedCard className="p-5">
              <RoleEditor role={null} allPermissions={permissionOptions} />
            </BorderedCard>
          </li>
        </ul>
      </section>

      {/* ── operators ─────────────────────────────────────────────── */}
      <EyebrowLabel>Operators</EyebrowLabel>
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
