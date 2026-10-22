import { cartResponse } from "@/lib/cart-api";
import { cartRoute } from "@/lib/cart-http";
import { readJson } from "@/lib/http-guards";
import { createCart } from "@/lib/store-carts";

// PayPal Cart API (agentic commerce, v1), merchant side: POST /merchant-cart.
// The store validates and prices the cart; a valid cart gets its PayPal order (payment_method.token).
// 201 with a payment token when the cart is valid; 200 with validation_issues when it is not.
export const maxDuration = 60;

export async function POST(request: Request, ctx: RouteContext<"/api/paypal/v1/stores/[supplier]/merchant-cart">) {
  return cartRoute(request, { write: true }, async () => {
    const { supplier } = await ctx.params;
    const { cart } = await createCart(supplier, await readJson(request), { source: "api" });
    return Response.json(cartResponse(cart), { status: cart.status === "CREATED" ? 201 : 200 });
  });
}
