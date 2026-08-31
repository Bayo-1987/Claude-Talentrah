import { requireAdmin } from "@/lib/admin/require-admin";
import { AdminMasthead } from "@/components/admin/admin-masthead";
import { AdminNav } from "@/components/admin/admin-nav";

/**
 * The guard, applied once to everything inside the group.
 *
 * A layout is the right place for it rather than a call at the top of each
 * page: a new admin page is protected by existing here, and forgetting to add
 * a line is not a way to ship an open one. `/admin/login` sits outside the
 * group and is the only page under /admin that this does not wrap.
 *
 * Note this is a Server Component doing a database round trip on every admin
 * navigation. That is intended — the session has to be revocable in real time,
 * and a cached "yes" is a revocation that does not take effect.
 */
export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <AdminMasthead email={admin.email} displayName={admin.displayName} />
      <AdminNav role={admin.role} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
