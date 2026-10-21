import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { StoreFront } from "@/components/client/StoreFront";
import { IconArrowLeft, IconSpark, IconTruck } from "@/components/icons";
import { OrderCard } from "@/components/OrderCard";
import { RESTAURANT, STORE_PRODUCTS, supplierById } from "@/data/seed";
import { paypalConfigured } from "@/lib/paypal";
import { orderApproved } from "@/lib/settlement";
import { readState } from "@/lib/state";

export async function generateMetadata(props: PageProps<"/store/[supplier]">): Promise<Metadata> {
  const { supplier } = await props.params;
  return { title: `${supplierById(supplier)?.name ?? "Store"} · trade store` };
}

export default async function StorePage(props: PageProps<"/store/[supplier]">) {
  await connection();
  const { supplier: id } = await props.params;
  const supplier = supplierById(id);
  if (!supplier?.store) notFound();
  const state = await readState();
  const products = STORE_PRODUCTS.filter((p) => p.supplierId === id);
  const lowSkus: Record<string, number> = {};
  for (const i of state.inventory) if (i.supplierId === id && i.onHand < i.par) lowSkus[i.sku] = i.par - i.onHand;
  const orders = [...state.orders].reverse().filter((o) => o.supplierId === id && orderApproved(o));
  const accent = supplier.store.accent;
  const card = state.cardOnFile ? `${state.cardOnFile.brand} •••• ${state.cardOnFile.last4}` : null;

  return (
    <div className="min-h-screen bg-[#f7f7f5] text-neutral-900" style={{ fontFamily: "var(--font-inter)" }}>
      <div className="bg-ink px-4 py-2 text-center text-xs text-paper/90">
        <Link href="/reorder" className="inline-flex items-center gap-1.5 hover:underline">
          <IconArrowLeft size={13} /> Back to Supplora Pay
        </Link>
        <span className="mx-2 opacity-40">·</span>
        You are viewing the online store of {supplier.name} (simulated merchant site)
      </div>
      <header style={{ background: accent }} className="text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-end sm:justify-between sm:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">Trade store</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">{supplier.name}</h1>
            <p className="mt-1 text-white/85">{supplier.store.tagline}</p>
          </div>
          <div className="rounded-xl bg-white/12 px-4 py-3 text-sm ring-1 ring-white/25">
            <p className="font-semibold">Trade account: {RESTAURANT.name}</p>
            <p className="flex items-center gap-1.5 text-white/80">
              <IconTruck size={14} /> {supplier.store.leadTime}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-8">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm">
          <IconSpark size={16} className="text-[#5b2b6e]" />
          <p className="min-w-0 flex-1 text-neutral-700">
            <strong>Agent-ready store.</strong> The catalog is published at{" "}
            <a href={`/api/store/${id}/catalog`} className="font-mono text-[12px] underline" target="_blank" rel="noreferrer">
              /api/store/{id}/catalog
            </a>{" "}
            and checkout runs on PayPal Orders v2, so Supplora&apos;s purchasing agent can shop here within the owner&apos;s limits.
          </p>
        </div>

        <StoreFront supplierId={id} products={products} accent={accent} lowSkus={lowSkus} cardLabel={card} paypalReady={paypalConfigured()} />

        {orders.length > 0 && (
          <section aria-labelledby="past" className="space-y-3">
            <h2 id="past" className="text-lg font-bold">
              Orders from {RESTAURANT.name}
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {orders.map((o) => (
                <OrderCard key={o.id} order={o} settleEnabled={false} />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
