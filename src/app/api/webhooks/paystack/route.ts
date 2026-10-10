import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { fulfillPayment } from "@/lib/billing/fulfill";

function isValidSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret || !signature) return false;

  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const signatureBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== signatureBuf.length) return false;
  return timingSafeEqual(expectedBuf, signatureBuf);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  if (!isValidSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody);

  if (event.event === "charge.success") {
    const result = await fulfillPayment(event.data.reference);
    // Paystack's verify has not caught up with the event it just sent (or says the payment is still in progress): answer a RETRYABLE error so Paystack delivers it again, instead of a 200 that
    // tells it the event was handled. The retry is idempotent (fulfillPayment grants once). Every other answer, a failure included, is final, and retrying it would help nobody.
    if (result.status === "processing") {
      // One content-free line so the 503 is visible in the logs: no reference, no payload, no person.
      console.warn("[paystack-webhook] fulfilment still processing: asked Paystack to retry");
      return NextResponse.json({ received: false, retry: true }, { status: 503 });
    }
  }

  return NextResponse.json({ received: true });
}
