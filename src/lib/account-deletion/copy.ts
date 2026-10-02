/** "1 credit", "12 credits". One place, so the email, the Settings section and the confirm page cannot disagree. */
export function creditsPhrase(n: number): string {
  return `${n} credit${n === 1 ? "" : "s"}`;
}
