// Pure status vocabulary for the payables grid. Kept import-free so the client
// grid bundle can use the labels/order without pulling in the seed directory or
// the server-side row builder (payables-view.ts).

import type { PayAction } from "@/lib/types";

/** The single status a payable shows: payment state first, then the review outcome. */
/** "sent" = PayPal processed the payout but it is UNCLAIMED: it waits until the supplier claims it. */
/** "returned" = PayPal gave an unclaimed payout back to the restaurant: the invoice is unpaid again. */
export type PayableStatus = "paid" | "sent" | "paying" | "failed" | "returned" | "held" | "disputed" | "pending";

/** Logical display order of statuses (most-urgent first) for the default sort. */
export const STATUS_ORDER: PayableStatus[] = ["failed", "returned", "held", "disputed", "pending", "paying", "sent", "paid"];

export const STATUS_LABEL: Record<PayableStatus, string> = {
  paid: "Paid",
  sent: "Sent · awaiting claim",
  paying: "Paying…",
  failed: "Payment failed",
  returned: "Returned · unpaid",
  held: "Held",
  disputed: "Pay partial",
  pending: "Open",
};

export const ACTION_LABEL: Record<PayAction, string> = {
  pay_full: "Pay in full",
  pay_partial: "Pay partial",
  hold: "Hold",
};

export function statusOf(paymentStatus: string, action: PayAction, withheldCents: number): PayableStatus {
  switch (paymentStatus) {
    case "paid":
      return "paid";
    case "unclaimed":
      return "sent";
    case "processing":
    case "scheduled":
      return "paying";
    case "failed":
      return "failed";
    case "returned":
      return "returned";
    default: // "unpaid"
      if (action === "hold") return "held";
      if (withheldCents > 0) return "disputed";
      return "pending";
  }
}
