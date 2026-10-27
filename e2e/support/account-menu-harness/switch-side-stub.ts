/** The side-switch Server Action, recorded. The real one is a "use server" function that cannot run in a blank document. */
export async function switchSideAction(formData: FormData): Promise<void> {
  window.__switched.push(String(formData.get("side")));
}
