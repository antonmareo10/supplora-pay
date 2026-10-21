"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { IconBook, IconCart, IconHome, IconInbox, IconMail, IconWallet } from "../icons";
import { cx } from "../ui";

export interface NavCounts {
  inbox: number;
  payments: number;
  disputes: number;
  reorder: number;
}

const ITEMS: { href: string; label: string; icon: ReactNode; count?: keyof NavCounts; hint: string }[] = [
  { href: "/", label: "Overview", icon: <IconHome size={17} />, hint: "This week at a glance" },
  { href: "/inbox", label: "Inbox", icon: <IconInbox size={17} />, count: "inbox", hint: "Documents to review" },
  { href: "/payments", label: "Payment run", icon: <IconWallet size={17} />, count: "payments", hint: "Plans awaiting approval" },
  { href: "/disputes", label: "Disputes", icon: <IconMail size={17} />, count: "disputes", hint: "Credit notes to request" },
  { href: "/reorder", label: "Reorder", icon: <IconCart size={17} />, count: "reorder", hint: "Items below par" },
  { href: "/ledger", label: "Ledger", icon: <IconBook size={17} />, hint: "Payments and audit log" },
];

export function NavLinks({ counts, variant }: { counts: NavCounts; variant: "side" | "top" }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  if (variant === "top") {
    return (
      <nav aria-label="Main" className="grid grid-cols-3 gap-1 pb-2 sm:flex sm:flex-wrap">
        {ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href) ? "page" : undefined}
            className={cx(
              "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[13px] transition sm:px-3 sm:text-sm",
              isActive(item.href) ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2",
            )}
          >
            {item.label}
            {item.count && counts[item.count] > 0 && (
              <span className={cx("num rounded-full px-1.5 text-[11px] font-semibold", isActive(item.href) ? "bg-paper/20" : "bg-paper-3 text-ink")}>
                {counts[item.count]}
              </span>
            )}
          </Link>
        ))}
      </nav>
    );
  }
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {ITEMS.map((item) => {
        const active = isActive(item.href);
        const n = item.count ? counts[item.count] : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "group flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] transition",
              active ? "bg-card text-ink shadow-[0_1px_0_rgba(60,45,20,0.06)] ring-1 ring-line" : "text-ink-2 hover:bg-paper-2 hover:text-ink",
            )}
          >
            <span className={cx("transition", active ? "text-ledger" : "text-muted group-hover:text-ink-2")}>{item.icon}</span>
            <span className="flex-1 font-medium">{item.label}</span>
            {n > 0 && (
              <span
                title={item.hint}
                className={cx("num min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold", active ? "bg-ledger text-white" : "bg-paper-3 text-ink-2")}
              >
                {n}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
