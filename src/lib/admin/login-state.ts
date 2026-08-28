/**
 * The login form's state, kept out of actions.ts because a "use server" module
 * may only export async functions — a plain object export there fails the
 * build, not at runtime. Same split as src/lib/scholarships/admin-state.ts.
 */
export interface AdminLoginState {
  error: string | null;
}

export const initialAdminLoginState: AdminLoginState = { error: null };
