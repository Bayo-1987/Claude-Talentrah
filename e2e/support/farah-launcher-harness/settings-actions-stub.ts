export async function dismissFarahHintAction(): Promise<void> {
  (window as unknown as { __hintDismissals: number }).__hintDismissals += 1;
}
