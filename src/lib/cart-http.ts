// HTTP plumbing for the stores' PayPal Cart API endpoints: every failure becomes the Cart API's error
// envelope ({ name, message, debug_id, details }) with a debug id that is also logged.

import { CartApiError, cartErrorBody, type CartErrorName } from "./cart-api";
import { assertSameOrigin, HttpError } from "./http-guards";
import { PayPalError, paypalConfigured } from "./paypal";

const nameFor = (status: number): CartErrorName =>
  status === 404 ? "CART_NOT_FOUND" : status === 422 || status === 409 || status === 429 ? "UNPROCESSABLE_ENTITY" : status >= 500 ? "INTERNAL_SERVER_ERROR" : "INVALID_REQUEST";

export async function cartRoute(request: Request, opts: { write: boolean }, fn: () => Promise<Response>): Promise<Response> {
  const debugId = `dbg_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  try {
    if (opts.write) {
      // Browsers on other sites cannot drive it; origin-less agents (server to server) can.
      assertSameOrigin(request);
      if (!paypalConfigured()) throw new CartApiError("INTERNAL_SERVER_ERROR", "This store cannot take payments: PayPal is not configured.", 503);
    }
    return await fn();
  } catch (err) {
    let e: CartApiError;
    if (err instanceof CartApiError) e = err;
    else if (err instanceof PayPalError) e = new CartApiError("INTERNAL_SERVER_ERROR", `PayPal: ${err.message}`, 502);
    else if (err instanceof HttpError) e = new CartApiError(nameFor(err.status), err.message, err.status);
    else {
      const status = (err as { status?: unknown })?.status;
      e =
        err instanceof Error && typeof status === "number" && status >= 400 && status < 600
          ? new CartApiError(nameFor(status), err.message, status)
          : new CartApiError("INTERNAL_SERVER_ERROR", "Unexpected error.", 500);
    }
    if (e.status >= 500) console.error(`[cart-api] ${debugId}`, err);
    else console.warn(`[cart-api] ${debugId} ${e.errorName}: ${e.message}`);
    return Response.json(cartErrorBody(e, debugId), { status: e.status });
  }
}
