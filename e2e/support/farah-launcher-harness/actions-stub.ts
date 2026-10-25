/** The sign-out Server Action, counted. The real one is a "use server" function that cannot run in a blank document. */
export async function signOutAction(): Promise<void> {
  window.__signOuts += 1;
}
