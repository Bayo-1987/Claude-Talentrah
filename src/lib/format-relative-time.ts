export function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return "Posted today";
  if (diffDays === 1) return "Posted 1 day ago";
  if (diffDays < 14) return `Posted ${diffDays} days ago`;
  const weeks = Math.floor(diffDays / 7);
  if (weeks < 8) return `Posted ${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.floor(diffDays / 30);
  return `Posted ${months} month${months === 1 ? "" : "s"} ago`;
}
