/** What posting an availability slot reports (MENTOR-SLOT-2). Its own file: a "use server" module may export nothing but async functions. */
export type PostSlotResult = { status: "posted" } | { status: "overlaps" | "error"; message: string };

export const SLOT_OVERLAP_MESSAGE = "You already have a slot at that time.";
export const SLOT_POST_FAILED_MESSAGE = "Could not post that slot. Please try again.";
