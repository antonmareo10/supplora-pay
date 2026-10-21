import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { DecisionControl, DocumentViewer, ReviewButton } from "@/components/client/ReviewControls";
import { IconArrowLeft, IconCheck, IconTruck } from "@/components/icons";
import { ACTION_TONE, buttonClass, Card, cx, docStatus, ErrorNote, Money, Mono, paymentLabel, Pill, SEVERITY_LABEL, SEVERITY_TONE, SeverityIcon, Stamp } from "@/components/ui";
import { CATALOG, DELIVERY_NOTES, supplierById } from "@/data/seed";
import { Guardrails, hasFraudHold } from "@/components/Guardrails";
import { ACTION_LABEL, effective, HOLD_ONLY_KINDS, isPaidOrSent } from "@/lib/ap";
import { claudeAvailable, claudeMode } from "@/lib/claude";
import { businessToday, fmtDay, fmtDateTime, relativeDue } from "@/lib/dates";
import { fmt, fmtQty, toCents } from "@/lib/money";
import { readState } from "@/lib/state";
import type { Finding, LineCheck } from "@/lib/types";

export async function generateMetadata(props: PageProps<"/inbox/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  return { title: `Review ${id}` };
}

const LINE_STATUS: Record<LineCheck["status"], { label: string; cls: string }> = {
  ok: { label: "OK", cls: "text-olive" },
  price_up: { label: "Price up", cls: "text-terracotta" },
  qty_short: { label: "Short", cls: "text-terracotta" },
  not_delivered: { label: "Not delivered", cls: "text-terracotta" },
  math: { label: "Math error", cls: "text-saffron" },
  unmatched: { label: "New item", cls: "text-muted" },
};

function FindingItem({ f }: { f: Finding }) {
  const tone = SEVERITY_TONE[f.severity];
  const border = { terracotta: "border-l-terracotta", saffron: "border-l-saffron", olive: "border-l-olive", ledger: "border-l-ledger", muted: "border-l-line-2", ink: "border-l-ink" }[tone];
  return (
    <li className={cx("rounded-xl border border-line border-l-4 bg-card p-4", border)}>
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <span className="mt-0.5">
          <SeverityIcon severity={f.severity} />
        </span>
        <p className="min-w-0 flex-1 font-semibold leading-snug text-ink">{f.title}</p>
        <Pill tone={tone}>{SEVERITY_LABEL[f.severity]}</Pill>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">{f.detail}</p>
      {f.evidence.length > 0 && (
        <dl className="mt-3 grid gap-x-4 gap-y-1 rounded-lg bg-paper/70 px-3 py-2 text-[13px] sm:grid-cols-2">
          {f.evidence.map((ev) => (
            <div key={ev.label} className="flex justify-between gap-3 border-b border-dashed border-line py-1 last:border-0 sm:[&:nth-last-child(2)]:border-0">
              <dt className="text-muted">{ev.label}</dt>
              <dd className="num text-right font-medium text-ink">{ev.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <span>{f.source === "claude" ? "Seen by Claude on the document" : "Rule check, computed in code from Claude's transcription"}</span>
        {f.withholdCents > 0 && !HOLD_ONLY_KINDS.includes(f.kind) && (
          <span className="num font-semibold text-terracotta">Withhold {fmt(f.withholdCents)}</span>
        )}
        {f.severity === "opportunity" && <span className="num font-semibold text-olive">Save {fmt(f.impactCents)}</span>}
      </div>
    </li>
  );
}

export default async function ReviewPage(props: PageProps<"/inbox/[id]">) {
  await connection();
  const { id } = await props.params;
  const state = await readState();
  const doc = state.documents.find((d) => d.id === id);
  if (!doc) notFound();
  const today = businessToday();
  const r = doc.review;
  const e = effective(doc);
  const supplier = r ? supplierById(r.supplierId) : undefined;
  const dn = r ? DELIVERY_NOTES.find((n) => n.id === r.deliveryNoteId) : undefined;
  const status = docStatus(doc);
  const title = r ? `${supplier?.name ?? r.extraction.supplier_name} · ${r.extraction.invoice_number ?? ""}` : doc.fileName;
  const lineFlags = new Map<number, Finding[]>();
  r?.findings.forEach((f) => f.lineIndex != null && lineFlags.set(f.lineIndex, [...(lineFlags.get(f.lineIndex) ?? []), f]));
  const settled = isPaidOrSent(doc);
  const partialAvailable = !!r && r.findings.some((f) => f.withholdCents > 0 && !HOLD_ONLY_KINDS.includes(f.kind));
  const fraudHold = !!e && e.action === "hold" && hasFraudHold(doc);

  return (
    <div>
      <Link href="/inbox" className="mb-5 inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink">
        <IconArrowLeft size={15} /> Inbox
      </Link>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
        <div className="lg:sticky lg:top-6 lg:self-start">
          <DocumentViewer url={doc.url} mimeType={doc.mimeType} title={title} />
          <p className="mt-2 text-xs text-muted">
            {doc.origin === "sample" ? "Sample document" : "Uploaded"} · {doc.fileName}
          </p>
        </div>

        <div className="min-w-0 space-y-6">
          <header>
            <div className="flex flex-wrap items-center gap-2">
              <Stamp tone={status.tone} tilt animate={!!r}>
                {status.icon}
                {status.label}
              </Stamp>
              {supplier && (
                <Pill tone="olive">
                  <IconCheck size={12} /> In your supplier directory
                </Pill>
              )}
              {r && !supplier && <Pill tone="terracotta">Unknown supplier</Pill>}
            </div>
            <h1 className="font-display mt-3 text-4xl leading-tight text-ink">{r ? supplier?.name ?? r.extraction.supplier_name : "Not reviewed yet"}</h1>
            {r && (
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted">Invoice</dt>
                  <dd className="font-medium">{r.extraction.invoice_number ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Issued</dt>
                  <dd className="font-medium">{fmtDay(r.extraction.invoice_date)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Due</dt>
                  <dd className="font-medium">
                    {fmtDay(r.dueDate)} <span className="text-xs font-normal text-muted">({relativeDue(today, r.dueDate)})</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Terms</dt>
                  <dd className="font-medium">{supplier?.termsLabel ?? r.extraction.payment_terms ?? "—"}</dd>
                </div>
              </dl>
            )}
          </header>

          {!r && (
            <Card className="p-6">
              {doc.reviewStatus === "failed" && <ErrorNote className="mb-4">Last attempt failed: {doc.reviewError}</ErrorNote>}
              <p className="font-display text-2xl">Let Claude read this document</p>
              <p className="mt-2 text-sm text-ink-2">
                Claude transcribes the supplier, every line, the totals and the payment terms, and matches them to your supplier directory. Supplora then
                checks each line against the signed delivery note and your price history, and recommends what to pay.
              </p>
              <div className="mt-5">
                <ReviewButton docId={doc.id} disabled={!claudeAvailable() || doc.reviewStatus === "reviewing"} label={doc.reviewStatus === "reviewing" ? "Review in progress…" : "Review with Claude"} />
                {!claudeAvailable() && <p className="mt-2 text-xs text-terracotta">Add ANTHROPIC_API_KEY to .env.local to enable reviews.</p>}
              </div>
            </Card>
          )}

          {r && e && (
            <>
              <Card className="perforated overflow-hidden">
                <div className="border-b border-line px-5 py-5 sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
                      {e.byOwner ? "Your decision" : "Recommendation"}
                    </p>
                    <Stamp tone={ACTION_TONE[e.action]}>{ACTION_LABEL[e.action]}</Stamp>
                  </div>
                  <p className="mt-2 text-[17px] leading-snug text-ink">{r.summary}</p>
                  {e.byOwner && (
                    <p className="mt-2 text-sm text-saffron">
                      You changed this from “{ACTION_LABEL[r.recommendation]}”{doc.decision?.note ? `: ${doc.decision.note}` : "."}
                    </p>
                  )}
                  <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-dashed border-line pt-4">
                    <div>
                      <dt className="text-xs text-muted">Invoice total</dt>
                      <dd className="num text-xl font-semibold text-ink">{fmt(r.invoiceCents)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">{e.action === "hold" ? "Held" : "Withheld"}</dt>
                      <dd className={cx("num text-xl font-semibold", e.withheldCents ? "text-terracotta" : "text-muted")}>{fmt(e.withheldCents)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">To pay</dt>
                      <dd className="num text-xl font-semibold text-olive">{fmt(e.payableCents)}</dd>
                      {r.discount?.available && e.action !== "hold" && (
                        <dd className="num text-xs text-olive">
                          {fmt(e.payableCents - Math.round((e.payableCents * r.discount.percent) / 100))} if paid by {fmtDay(r.discount.deadline)}
                        </dd>
                      )}
                    </div>
                  </dl>
                </div>
                <div className="bg-paper/50 px-5 py-4 sm:px-6">
                  <DecisionControl docId={doc.id} recommended={r.recommendation} current={e.action} locked={settled} partialAvailable={partialAvailable} />
                  {doc.payment.status !== "unpaid" && (
                    <p className="mt-3 text-sm text-ink-2">
                      Payment: <strong>{paymentLabel(doc.payment.status)}</strong>
                      {doc.payment.amountCents != null && <> · {fmt(doc.payment.amountCents)}</>}
                      {doc.payment.batchId && (
                        <>
                          {" "}
                          · PayPal batch <Mono>{doc.payment.batchId}</Mono>
                        </>
                      )}
                      {doc.payment.payoutItemId && (
                        <>
                          {" "}
                          · item <Mono>{doc.payment.payoutItemId}</Mono>
                        </>
                      )}
                    </p>
                  )}
                </div>
              </Card>

              <section aria-labelledby="findings">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 id="findings" className="font-display text-2xl">
                    Findings
                  </h2>
                  <span className="text-xs text-muted">{r.findings.length === 0 ? "none" : `${r.findings.length} found`}</span>
                </div>
                {r.findings.length === 0 ? (
                  <div className="flex items-start gap-3 rounded-xl border border-olive/25 bg-olive-soft px-4 py-3 text-sm text-olive">
                    <IconCheck size={18} className="mt-0.5 shrink-0" />
                    <p>
                      Clean invoice. The supplier is in your directory, every line matches the signed delivery note
                      {dn ? ` ${dn.number}` : ""}, prices match your history and the totals add up.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {r.findings.map((f) => (
                      <FindingItem key={f.id} f={f} />
                    ))}
                  </ul>
                )}
              </section>

              <Guardrails doc={doc} state={state} />

              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5 sm:px-6">
                  <h2 className="font-display text-2xl">Lines</h2>
                  <span className="text-xs text-muted">Transcribed by Claude · checked against {dn ? `delivery note ${dn.number}` : "price history"}</span>
                </div>
                {/* Phones: one card per line, so Total and Check stay visible without scrolling sideways. */}
                <ul className="mt-3 divide-y divide-line border-t border-line sm:hidden">
                  {r.extraction.lines.map((line, i) => {
                    const c = r.lineChecks[i];
                    const st = LINE_STATUS[c?.status ?? "ok"];
                    const mapped = CATALOG.find((x) => x.key === line.matched_item_key);
                    const short = c?.deliveredQty != null && c.deliveredQty < line.quantity;
                    return (
                      <li key={i} className={cx("px-5 py-3", lineFlags.has(i) && "bg-terracotta-soft/40")}>
                        <div className="flex items-start justify-between gap-3">
                          <p className="min-w-0 font-medium leading-snug text-ink">
                            {line.description}
                            {mapped && mapped.name.toLowerCase() !== line.description.toLowerCase() && (
                              <span className="block text-xs font-normal text-muted">= {mapped.name}</span>
                            )}
                          </p>
                          <span className={cx("shrink-0 pt-0.5 text-xs font-semibold", st.cls)}>{st.label}</span>
                        </div>
                        <dl className="mt-1.5 grid grid-cols-4 gap-x-2 text-[13px]">
                          <div>
                            <dt className="text-[10.5px] uppercase tracking-wider text-muted">Invoiced</dt>
                            <dd className="num">
                              {fmtQty(line.quantity)} {line.unit}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[10.5px] uppercase tracking-wider text-muted">Received</dt>
                            <dd className={cx("num", short ? "font-semibold text-terracotta" : "text-ink-2")}>{c?.deliveredQty != null ? fmtQty(c.deliveredQty) : "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-[10.5px] uppercase tracking-wider text-muted">Price</dt>
                            <dd className={cx("num", c?.status === "price_up" && "font-semibold text-terracotta")}>{fmt(toCents(line.unit_price))}</dd>
                            {c?.lastPriceCents != null && c.lastPriceCents !== toCents(line.unit_price) && (
                              <dd className="num text-[11px] text-muted">usual {fmt(c.lastPriceCents)}</dd>
                            )}
                          </div>
                          <div className="text-right">
                            <dt className="text-[10.5px] uppercase tracking-wider text-muted">Total</dt>
                            <dd className={cx("num", c?.status === "math" && "font-semibold text-saffron")}>{fmt(toCents(line.line_total))}</dd>
                          </div>
                        </dl>
                      </li>
                    );
                  })}
                  <li className="bg-paper/60 px-5 py-2.5 text-sm">
                    <span className="text-muted">
                      Subtotal {r.extraction.subtotal != null && <Money cents={toCents(r.extraction.subtotal)} />} · VAT{" "}
                      {r.extraction.vat_total != null && <Money cents={toCents(r.extraction.vat_total)} />} · Total{" "}
                    </span>
                    <span className="num font-semibold">{fmt(r.invoiceCents)}</span>
                  </li>
                </ul>
                <div className="table-wrap mt-3 hidden sm:block">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-y border-line bg-paper/60 text-left text-[11px] uppercase tracking-wider text-muted">
                        <th scope="col" className="py-2 pl-5 pr-2 font-semibold sm:pl-6">
                          Item
                        </th>
                        <th scope="col" className="px-1.5 py-2 text-right font-semibold">
                          Invoiced
                        </th>
                        <th scope="col" className="px-1.5 py-2 text-right font-semibold">
                          Received
                        </th>
                        <th scope="col" className="px-1.5 py-2 text-right font-semibold">
                          Price
                        </th>
                        <th scope="col" className="px-1.5 py-2 text-right font-semibold">
                          Usual
                        </th>
                        <th scope="col" className="px-1.5 py-2 text-right font-semibold">
                          Total
                        </th>
                        <th scope="col" className="py-2 pl-2 pr-5 text-right font-semibold sm:pr-6">
                          Check
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.extraction.lines.map((line, i) => {
                        const c = r.lineChecks[i];
                        const st = LINE_STATUS[c?.status ?? "ok"];
                        const mapped = CATALOG.find((x) => x.key === line.matched_item_key);
                        const flagged = lineFlags.has(i);
                        return (
                          <tr key={i} className={cx("border-b border-line last:border-0", flagged && "bg-terracotta-soft/40")}>
                            <td className="py-2.5 pl-5 pr-2 sm:pl-6">
                              <span className="font-medium text-ink">{line.description}</span>
                              {mapped && mapped.name.toLowerCase() !== line.description.toLowerCase() && (
                                <span className="block text-xs text-muted">= {mapped.name}</span>
                              )}
                            </td>
                            <td className="num px-1.5 py-2.5 text-right">
                              {fmtQty(line.quantity)} {line.unit}
                            </td>
                            <td className={cx("num px-1.5 py-2.5 text-right", c?.deliveredQty != null && c.deliveredQty < line.quantity ? "font-semibold text-terracotta" : "text-ink-2")}>
                              {c?.deliveredQty != null ? fmtQty(c.deliveredQty) : "—"}
                            </td>
                            <td className={cx("num px-1.5 py-2.5 text-right", c?.status === "price_up" && "font-semibold text-terracotta")}>{fmt(toCents(line.unit_price))}</td>
                            <td className="num px-1.5 py-2.5 text-right text-ink-2">{c?.lastPriceCents != null ? fmt(c.lastPriceCents) : "—"}</td>
                            <td className={cx("num px-1.5 py-2.5 text-right", c?.status === "math" && "font-semibold text-saffron")}>{fmt(toCents(line.line_total))}</td>
                            <td className={cx("py-2.5 pl-2 pr-5 text-right text-xs font-semibold sm:pr-6", st.cls)}>{st.label}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line bg-paper/60 text-sm">
                        <td colSpan={5} className="py-2 pl-5 text-right text-muted sm:pl-6">
                          Subtotal {r.extraction.subtotal != null && <Money cents={toCents(r.extraction.subtotal)} />} · VAT{" "}
                          {r.extraction.vat_total != null && <Money cents={toCents(r.extraction.vat_total)} />}
                        </td>
                        <td className="num px-1.5 py-2 text-right font-semibold">{fmt(r.invoiceCents)}</td>
                        <td className="pr-5 sm:pr-6" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>

              {dn && (
                <Card className="p-5 sm:p-6">
                  <div className="flex items-start gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper text-ledger ring-1 ring-line">
                      <IconTruck size={18} />
                    </span>
                    <div>
                      <h2 className="font-display text-2xl leading-tight">Delivery note {dn.number}</h2>
                      <p className="text-sm text-ink-2">
                        Received {fmtDay(dn.date)} and signed by {dn.receivedBy}. Captured by Supplora at the kitchen door, so it records what actually
                        arrived.
                      </p>
                    </div>
                  </div>
                  <ul className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    {dn.lines.map((l) => (
                      <li key={l.itemKey} className="flex justify-between border-b border-dashed border-line py-1.5">
                        <span className="text-ink-2">{l.description}</span>
                        <span className="num font-medium">
                          {fmtQty(l.qty)} {l.unit}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-paper/60 px-4 py-3 text-xs text-muted">
                <span>
                  {r.replayed || (r.cached && claudeMode() === "replay") ? (
                    <>
                      Recorded reading by Claude (<Mono>{r.model}</Mono>
                      {r.recordedAt ? `, recorded ${fmtDay(r.recordedAt.slice(0, 10))}` : ""}, took {(r.durationMs / 1000).toFixed(1)} s), replayed in
                      this demo; the checks ran live
                    </>
                  ) : (
                    <>
                      Read by Claude (<Mono>{r.model}</Mono>) in {(r.durationMs / 1000).toFixed(1)} s{r.cached ? " · cached reading reused" : ""}
                    </>
                  )}{" "}
                  · reviewed {fmtDateTime(r.reviewedAt)} · legibility {r.extraction.legibility.replace("_", " ")}
                </span>
                {!settled && <ReviewButton docId={doc.id} label="Review again" variant="ghost" />}
              </div>

              {e.action !== "pay_full" && !settled && (
                <div className="flex flex-wrap gap-2">
                  {!fraudHold && (
                    <Link href="/disputes" className={buttonClass("ghost")}>
                      Draft the credit-note request
                    </Link>
                  )}
                  <Link href="/payments" className={buttonClass("primary")}>
                    Go to the payment run
                  </Link>
                </div>
              )}
              {e.action === "pay_full" && !settled && (
                <Link href="/payments" className={buttonClass("primary")}>
                  Go to the payment run
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
