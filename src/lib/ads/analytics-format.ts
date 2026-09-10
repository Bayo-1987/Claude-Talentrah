/**
 * "N/A", not "0.0%" or a divide-by-zero NaN, when a campaign has no
 * impressions yet — a rate computed over zero opportunities is not a real
 * zero, it is an undefined one, and the two must not look the same on
 * screen. Shared by the per-campaign and the org-wide analytics pages so
 * they can never quietly disagree about how CTR is presented.
 */
export function ctrLabel(clicks: number, impressions: number): string {
  if (impressions <= 0) return "N/A";
  return `${((clicks / impressions) * 100).toFixed(1)}%`;
}
