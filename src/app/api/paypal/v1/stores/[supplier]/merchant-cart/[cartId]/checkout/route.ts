import { CartApiError, cartResponse, isCartId } from "@/lib/cart-api";
import { cartRoute } from "@/lib/cart-http";
import { checkoutCart, storeFor } from "@/lib/store-carts";

// PayPal Cart API (agentic commerce, v1), merchant side: POST /merchant-cart/{cart_id}/checkout.
// Completes the cart only when PayPal shows the buyer's payment authorized. In this app only the
// restaurant owner's approval authorizes a payment, so an agent calling this first gets a 422 with a
// PAYMENT_ERROR issue whose resolution is REQUEST_APPROVAL.
export const maxDuration = 60;

export async function POST(request: Request, ctx: RouteContext<"/api/paypal/v1/stores/[supplier]/merchant-cart/[cartId]/checkout">) {
  return cartRoute(request, { write: true }, async () => {
    const { supplier, cartId } = await ctx.params;
    storeFor(supplier);
    if (!isCartId(cartId)) throw new CartApiError("CART_NOT_FOUND", "No such cart.", 404);
    return Response.json(cartResponse(await checkoutCart(supplier, cartId)));
  });
}
