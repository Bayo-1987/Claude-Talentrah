/** The card's Server Actions, which are "use server" functions that cannot run in a blank document. They do nothing: the harness measures layout. */
export async function toggleSaveAction(): Promise<void> {}
export async function applyInAppAction(): Promise<void> {}
export async function markAppliedExternallyAction(): Promise<void> {}
