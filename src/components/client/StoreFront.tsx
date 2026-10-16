"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { fmt, pctOf } from "@/lib/money";
import type { StoreOrder, StoreProduct } from "@/lib/types";
import { IconCard, IconCheck, IconMinus, IconPlus } from "../icons";
import { buttonClass, cx, ErrorNote, Mono } from "../ui";
import { errorText, postJson } from "./api";

export function StoreFront({
  supplierId,
  products,
  accent,
  lowSkus,
  cardLabel,
  paypalReady,
}: {
  supplierId: string;
  products: StoreProduct[];
  accent: string;
  lowSkus: Record<string, number>;
  cardLabel: string | null;
  paypalReady: boolean;
}) {
  const router = useRouter();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<StoreOrder | null>(null);

  const lines = useMemo(
    () =>
      products
        .filter((p) => cart[p.sku])
        .map((p) => {
          const qty = cart[p.sku];
          const net = p.unitPriceCents * qty;
          return { p, qty, net, vat: pctOf(p.unitPriceCents, p.vatRate) * qty };
        }),
    [cart, products],
  );
  const net = lines.reduce((s, l) => s + l.net, 0);
  const vat = lines.reduce((s, l) => s + l.vat, 0);

  const setQty = (sku: string, qty: number) =>
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[sku];
      else next[sku] = Math.min(50, qty);
      return next;
    });

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {products.map((p) => {
          const qty = cart[p.sku] ?? 0;
          const need = lowSkus[p.sku];
          return (
            <li key={p.sku} className="flex flex-col rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
              <div className="mb-3 grid h-24 place-items-center rounded-xl" style={{ background: `${accent}12` }} aria-hidden="true">
                <span className="text-3xl font-black tracking-tight" style={{ color: accent }}>
                  {p.name
                    .split(" ")
                    .slice(0, 2)
                    .map((w) => w[0])
                    .join("")}
                </span>
              </div>
              <p className="font-semibold leading-snug text-neutral-900">{p.name}</p>
              <p className="text-xs text-neutral-500">
                {p.pack} · SKU <Mono className="text-neutral-500">{p.sku}</Mono>
              </p>
              {need != null && <p className="mt-1 text-xs font-medium text-[#8a5a0c]">Your stock is low: {need} below par</p>}
              <div className="mt-auto flex items-end justify-between pt-3">
                <p>
                  <span className="num text-lg font-bold text-neutral-900">{fmt(p.unitPriceCents)}</span>
                  <span className="block text-[11px] text-neutral-500">excl. {p.vatRate}% VAT · {p.inStock} in stock</span>
                </p>
                {qty === 0 ? (
                  <button
                    type="button"
                    onClick={() => setQty(p.sku, need ?? 1)}
                    className="rounded-full px-3.5 py-1.5 text-sm font-semibold text-white transition hover:opacity-90"
                    style={{ background: accent }}
                    aria-label={`Add ${p.name} to cart`}
                  >
                    Add
                  </button>
                ) : (
                  <div className="flex items-center gap-1 rounded-full border border-black/15 p-0.5">
                    <button type="button" onClick={() => setQty(p.sku, qty - 1)} className="grid h-7 w-7 place-items-center rounded-full hover:bg-black/5" aria-label={`One less ${p.name}`}>
                      <IconMinus size={14} />
                    </button>
                    <span className="num w-6 text-center text-sm font-semibold" aria-live="polite">
                      {qty}
                    </span>
                    <button type="button" onClick={() => setQty(p.sku, qty + 1)} className="grid h-7 w-7 place-items-center rounded-full hover:bg-black/5" aria-label={`One more ${p.name}`}>
                      <IconPlus size={14} />
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <aside className="lg:sticky lg:top-6 lg:self-start" aria-labelledby="cart-title">
        <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
          <h2 id="cart-title" className="text-lg font-bold text-neutral-900">
            Your order
          </h2>
          {done ? (
            <div className="rise mt-3 space-y-2 text-sm">
              <p className="flex items-center gap-2 font-semibold text-[#2f4a35]">
                <IconCheck size={16} /> Paid with PayPal
              </p>
              <p className="text-neutral-600">
                Order <Mono>{done.id}</Mono> · capture <Mono>{done.captureId}</Mono> ({done.captureStatus})
              </p>
              <p className="num text-neutral-900">Total {fmt(done.totalCents)}</p>
              <button type="button" onClick={() => setDone(null)} className="text-sm font-medium underline">
                Start a new order
              </button>
            </div>
          ) : lines.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">Your cart is empty. Items your kitchen is low on are marked.</p>
          ) : (
            <>
              <ul className="mt-3 divide-y divide-black/5 text-sm">
                {lines.map((l) => (
                  <li key={l.p.sku} className="flex justify-between gap-3 py-2">
                    <span>
                      <span className="num font-semibold">{l.qty}×</span> {l.p.name}
                    </span>
                    <span className="num">{fmt(l.net)}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-3 space-y-1 border-t border-black/10 pt-3 text-sm">
                <div className="flex justify-between text-neutral-600">
                  <dt>Subtotal</dt>
                  <dd className="num">{fmt(net)}</dd>
                </div>
                <div className="flex justify-between text-neutral-600">
                  <dt>VAT</dt>
                  <dd className="num">{fmt(vat)}</dd>
                </div>
                <div className="flex justify-between text-base font-bold text-neutral-900">
                  <dt>Total</dt>
                  <dd className="num">{fmt(net + vat)}</dd>
                </div>
              </dl>
              <button
                type="button"
                disabled={busy || !paypalReady}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const res = await postJson<{ order: StoreOrder }>(`/api/store/${supplierId}/checkout`, {
                      items: lines.map((l) => ({ sku: l.p.sku, qty: l.qty })),
                    });
                    setDone(res.order);
                    setCart({});
                    router.refresh();
                  } catch (err) {
                    setError(errorText(err));
                  } finally {
                    setBusy(false);
                  }
                }}
                className={cx(buttonClass("primary", "lg"), "mt-4 w-full !bg-[#ffc439] !text-[#111] hover:!bg-[#f2b92f]")}
              >
                <IconCard size={16} /> {busy ? "Paying…" : `Pay ${fmt(net + vat)} with PayPal`}
              </button>
              <p className="mt-2 text-[11px] leading-snug text-neutral-500">
                Charged to Taberna El Faro&apos;s card on file{cardLabel ? ` (${cardLabel})` : ""} through PayPal Orders v2: create, confirm with the vault
                token, capture. Sandbox, no real money.
              </p>
              {error && <ErrorNote className="mt-3">{error}</ErrorNote>}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
