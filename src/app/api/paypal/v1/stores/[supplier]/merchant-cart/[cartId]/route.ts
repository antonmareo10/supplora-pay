import { CartApiError, cartResponse, isCartId } from "@/lib/cart-api";
import { cartRoute } from "@/lib/cart-http";
import { readJson } from "@/lib/http-guards";
import { findCart, replaceCart, storeFor } from "@/lib/store-carts";

// PayPal Cart API (agentic commerce, v1), merchant side: GET and PUT /merchant-cart/{cart_id}.
// PUT is a full replacement: fields not sent are dropped and the cart is validated again.
export const maxDuration = 60;

type Ctx = RouteContext<"/api/paypal/v1/stores/[supplier]/merchant-cart/[cartId]">;

async function params(ctx: Ctx) {
  const { supplier, cartId } = await ctx.params;
  storeFor(supplier);
  if (!isCartId(cartId)) throw new CartApiError("CART_NOT_FOUND", "No such cart.", 404);
  return { supplier, cartId };
}

export async function GET(request: Request, ctx: Ctx) {
  return cartRoute(request, { write: false }, async () => {
    const { supplier, cartId } = await params(ctx);
    return Response.json(cartResponse(await findCart(supplier, cartId)));
  });
}

export async function PUT(request: Request, ctx: Ctx) {
  return cartRoute(request, { write: true }, async () => {
    const { supplier, cartId } = await params(ctx);
    const { cart } = await replaceCart(supplier, cartId, await readJson(request));
    return Response.json(cartResponse(cart));
  });
}
