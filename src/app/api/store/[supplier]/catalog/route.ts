import { storeCatalog } from "@/lib/restock";

// Public, machine-readable product feed of a supplier store: what the purchasing agent reads.
export async function GET(_request: Request, ctx: RouteContext<"/api/store/[supplier]/catalog">) {
  const { supplier } = await ctx.params;
  const catalog = storeCatalog(supplier);
  if (!catalog) return Response.json({ error: "Store not found" }, { status: 404 });
  return Response.json(catalog, { headers: { "cache-control": "public, max-age=300" } });
}
