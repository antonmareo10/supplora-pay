// Server-safe UI primitives (no hooks).
import type { ReactNode } from "react";
import { fmt } from "@/lib/money";
import type { DocumentRecord, PayAction, Severity } from "@/lib/types";
import { IconAlert, IconCheck, IconClock, IconInfo, IconPause, IconSpark } from "./icons";

export type Tone = "olive" | "saffron" | "terracotta" | "ledger" | "muted" | "ink";

const TONE_TEXT: Record<Tone, string> = {
  olive: "text-olive",
  saffron: "text-saffron",
  terracotta: "text-terracotta",
  ledger: "text-ledger",
  muted: "text-muted",
  ink: "text-ink",
};

const TONE_PILL: Record<Tone, string> = {
  olive: "border-olive/25 bg-olive-soft text-olive",
  saffron: "border-saffron/30 bg-saffron-soft text-[#8a5a0c]",
  terracotta: "border-terracotta/25 bg-terracotta-soft text-terracotta",
  ledger: "border-ledger/20 bg-ledger-soft text-ledger",
  muted: "border-line bg-paper text-ink-2",
  ink: "border-ink/80 bg-ink text-paper",
};

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function buttonClass(variant: "primary" | "ink" | "ghost" | "danger" | "quiet" = "primary", size: "sm" | "md" | "lg" = "md"): string {
  const sizes = { sm: "h-8 px-3 text-xs gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-12 px-5 text-[15px] gap-2" };
  const variants = {
    primary: "bg-ledger text-white hover:bg-ledger-2 shadow-[0_1px_0_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.12)]",
    ink: "bg-ink text-paper hover:bg-ink-2",
    ghost: "border border-line-2 bg-card text-ink hover:border-ink-2/50 hover:bg-paper",
    danger: "border border-terracotta/40 bg-card text-terracotta hover:bg-terracotta-soft",
    quiet: "text-ink-2 hover:bg-paper-2 hover:text-ink",
  };
  return cx(
    "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    sizes[size],
    variants[variant],
  );
}

export function PageHeader({ kicker, title, children, actions }: { kicker: string; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{kicker}</p>
        <h1 className="font-display mt-1 text-4xl leading-[1.05] text-ink sm:text-5xl">{title}</h1>
        {children && <div className="mt-3 text-[15px] leading-relaxed text-ink-2">{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ children, className, as: As = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" } & Record<string, unknown>) {
  return (
    <As className={cx("rounded-2xl border border-line bg-card shadow-[0_1px_0_rgba(60,45,20,0.04)]", className)} {...rest}>
      {children}
    </As>
  );
}

export function SectionTitle({ kicker, title, aside, id }: { kicker?: string; title: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        {kicker && <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">{kicker}</p>}
        <h2 id={id} className="font-display text-2xl leading-tight text-ink">
          {title}
        </h2>
      </div>
      {aside}
    </div>
  );
}

export function Stamp({ tone, children, tilt, animate, className }: { tone: Tone; children: ReactNode; tilt?: boolean; animate?: boolean; className?: string }) {
  return <span className={cx("stamp", TONE_TEXT[tone], tilt && "stamp-tilt", animate && "stamp-in", className)}>{children}</span>;
}

export function Pill({ tone = "muted", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium", TONE_PILL[tone], className)}>
      {children}
    </span>
  );
}

export function Money({ cents, className, strike }: { cents: number | null | undefined; className?: string; strike?: boolean }) {
  return <span className={cx("num", strike && "text-muted line-through decoration-1", className)}>{fmt(cents)}</span>;
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cx("font-mono text-[12px] tracking-tight text-ink-2", className)}>{children}</code>;
}

export function Kpi({ label, value, hint, tone = "ink" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-line bg-card px-4 py-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className={cx("num mt-1 text-2xl font-semibold tracking-tight", TONE_TEXT[tone])}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line-2 bg-paper/60 px-6 py-10 text-center">
      <p className="font-display text-2xl text-ink">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-ink-2">{children}</div>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="alert" className={cx("flex items-start gap-2 rounded-xl border border-terracotta/30 bg-terracotta-soft px-3.5 py-2.5 text-sm text-terracotta", className)}>
      <IconAlert size={16} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export const SEVERITY_TONE: Record<Severity, Tone> = {
  high: "terracotta",
  medium: "saffron",
  low: "ledger",
  info: "muted",
  opportunity: "olive",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  high: "High",
  medium: "Medium",
  low: "Note",
  info: "Info",
  opportunity: "Saving",
};

export function SeverityIcon({ severity, size = 16 }: { severity: Severity; size?: number }) {
  const cls = TONE_TEXT[SEVERITY_TONE[severity]];
  if (severity === "opportunity") return <IconSpark size={size} className={cls} />;
  if (severity === "info" || severity === "low") return <IconInfo size={size} className={cls} />;
  return <IconAlert size={size} className={cls} />;
}

export const ACTION_TONE: Record<PayAction, Tone> = { pay_full: "olive", pay_partial: "saffron", hold: "terracotta" };

/** The one status a document shows in lists: payment state first, then the review outcome. */
export function docStatus(doc: DocumentRecord): { label: string; tone: Tone; icon?: ReactNode } {
  switch (doc.payment.status) {
    case "paid":
      return { label: "Paid", tone: "ink", icon: <IconCheck size={12} /> };
    case "unclaimed":
      // PayPal processed the payout but holds it until the supplier claims it: not settled yet.
      return { label: "Sent · awaiting claim", tone: "saffron", icon: <IconClock size={12} /> };
    case "processing":
    case "scheduled":
      return { label: "Paying…", tone: "ledger" };
    case "failed":
      return { label: "Payment failed", tone: "terracotta" };
    case "returned":
      return { label: "Payout returned · unpaid", tone: "saffron" };
  }
  if (doc.reviewStatus === "reviewing") return { label: "Reviewing…", tone: "ledger" };
  if (doc.reviewStatus === "failed") return { label: "Review failed", tone: "terracotta" };
  if (!doc.review) return { label: "Not reviewed", tone: "muted" };
  const action = doc.decision?.action ?? doc.review.recommendation;
  if (action === "hold") return { label: "Hold", tone: "terracotta", icon: <IconPause size={12} /> };
  if (action === "pay_partial") return { label: "Pay partial", tone: "saffron" };
  return { label: "Pay in full", tone: "olive", icon: <IconCheck size={12} /> };
}

/** Plain-words payment status for detail lines (UNCLAIMED is not "paid": PayPal holds it until claimed). */
export function paymentLabel(status: DocumentRecord["payment"]["status"]): string {
  if (status === "unclaimed") return "sent, awaiting the supplier's claim (PayPal UNCLAIMED)";
  if (status === "returned") return "payout returned to the restaurant's PayPal balance; the invoice is unpaid";
  return status;
}

export function amountLabel(cents: number): string {
  return fmt(cents);
}
