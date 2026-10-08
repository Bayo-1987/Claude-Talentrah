/** Result shape for the Mark refunded form. Kept out of refund-actions.ts because a "use server" module may export only async functions. */
export interface RefundActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

export const initialRefundActionState: RefundActionState = { status: "idle" };
