"use client";

import { useSyncExternalStore } from "react";
import { formatInterviewRange, formatInterviewTime } from "@/lib/interviews/format";

const subscribe = () => () => {};
const clientZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};
const serverZone = () => "UTC";

/**
 * An interview time in the VIEWER's own zone. The server renders it in UTC (it cannot know the browser's zone); on the client the browser's zone is used, so a candidate in London and an employer in Lagos
 * each read the same stored instant in their own clock, before and after a clock change.
 */
export function LocalTime({ startsAt, durationMinutes }: { startsAt: string; durationMinutes: number }) {
  const zone = useSyncExternalStore(subscribe, clientZone, serverZone);
  return <time dateTime={startsAt} suppressHydrationWarning>{formatInterviewRange(startsAt, durationMinutes, zone)}</time>;
}

/** The start only ("Mon, 26 Oct 2026, 10:00 GMT+1"), in the viewer's zone: the Job Tracker's "Interview scheduled, <date>". */
export function LocalDateTime({ startsAt }: { startsAt: string }) {
  const zone = useSyncExternalStore(subscribe, clientZone, serverZone);
  return <time dateTime={startsAt} suppressHydrationWarning>{formatInterviewTime(startsAt, zone)}</time>;
}
