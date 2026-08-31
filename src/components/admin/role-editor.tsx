"use client";

import { useActionState } from "react";
import { saveRoleAction, deleteRoleAction } from "@/lib/admin/operators/role-actions";
import { initialOperatorActionState } from "@/lib/admin/operators/state";
import { Button, TextField } from "@/components/ui";

/**
 * One role: its name, its permissions, and whether it can be deleted.
 *
 * PERMISSIONS ARE CHECKBOXES POSTED AS A SET, not toggles that each save on
 * change. A role's permissions are evaluated together — dropping `operators`
 * is only refusable in the context of everything else — so the form submits
 * the whole set and the database decides once. Per-checkbox saves would also
 * mean a half-applied role between two clicks.
 *
 * Nothing here enforces anything. admin_upsert_role and admin_delete_role
 * re-check the actor and the coverage invariant in the same statement that
 * writes; this component is allowed to be wrong about what is permitted.
 */
export interface PermissionOption {
  key: string;
  label: string;
}

export function RoleEditor({
  role,
  allPermissions,
}: {
  /** Null when this is the "create a role" form. */
  role: { id: string; name: string; isBuiltin: boolean; permissions: string[] } | null;
  allPermissions: readonly PermissionOption[];
}) {
  const [saveState, save, saving] = useActionState(saveRoleAction, initialOperatorActionState);
  const [deleteState, remove, deleting] = useActionState(
    deleteRoleAction,
    initialOperatorActionState,
  );
  const id = role?.id ?? "new-role";
  const state =
    saveState.targetId === id && saveState.status !== "idle"
      ? saveState
      : deleteState.targetId === id && deleteState.status !== "idle"
        ? deleteState
        : null;

  return (
    <div className="flex flex-col gap-4">
      <form action={save} className="flex flex-col gap-4">
        {role && <input type="hidden" name="roleId" value={role.id} />}

        <div className="flex flex-wrap items-end gap-3">
          <TextField
            id={`role-name-${id}`}
            label={role ? "Name" : "New role name"}
            name="name"
            defaultValue={role?.name ?? ""}
            required
          />
          {role?.isBuiltin && (
            /*
              Built-in roles are renameable and re-permissionable like any
              other — only deletion is refused, because grant-admin and 0075's
              backfill refer to them by name.
            */
            <span className="pb-2 font-display text-[13px] italic text-ink-soft">
              Built-in — can be edited, not deleted.
            </span>
          )}
        </div>

        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend className="font-body text-[13px] font-semibold text-ink">Permissions</legend>
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {allPermissions.map((p) => (
              <label
                key={p.key}
                className="flex min-h-10 cursor-pointer items-center gap-2 text-[14px] text-ink hover:text-rust"
              >
                <input
                  type="checkbox"
                  name="permissions"
                  value={p.key}
                  defaultChecked={role?.permissions.includes(p.key) ?? false}
                  className="accent-rust"
                />
                {p.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving…" : role ? "Save role" : "Create role"}
          </Button>
        </div>
      </form>

      {role && !role.isBuiltin && (
        <form action={remove}>
          <input type="hidden" name="roleId" value={role.id} />
          <Button type="submit" size="sm" variant="secondary" disabled={deleting}>
            {deleting ? "Deleting…" : "Delete role"}
          </Button>
        </form>
      )}

      {state && (
        <p
          role="status"
          className={
            "border-[1.5px] px-3.5 py-2.5 text-[13.5px] " +
            (state.status === "error"
              ? "border-rust bg-rust-soft text-rust"
              : "border-ink bg-card text-ink")
          }
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
