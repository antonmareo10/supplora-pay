"use client";

// A euro count-up that animates on mount and respects prefers-reduced-motion.
// Server-rendered as the final value (so no-JS and SSR show the real number); on the client it
// counts up from zero with a requestAnimationFrame tween before the first paint, so there is no flash
// of the final figure first. No dependency: a ~1 KB component, in keeping with the lean stack.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fmt } from "@/lib/money";

// useLayoutEffect on the client (runs before paint, no flash), useEffect during SSR (no warning).
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function CountUpMoney({
  cents,
  className,
  durationMs = 1100,
}: {
  cents: number;
  className?: string;
  durationMs?: number;
}) {
  const [display, setDisplay] = useState(cents);
  const started = useRef(false);

  useIsoLayoutEffect(() => {
    if (typeof window === "undefined") return;
    // Animate once per mount; re-animate only when the target actually changes.
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduce || cents === 0) {
      setDisplay(cents);
      return;
    }
    started.current = true;
    let raf = 0;
    let startTime = 0;
    setDisplay(0);
    const tick = (now: number) => {
      if (!startTime) startTime = now;
      const t = Math.min(1, (now - startTime) / durationMs);
      setDisplay(Math.round(cents * easeOutCubic(t)));
      if (t < 1) raf = requestAnimationFrame(tick);
      else setDisplay(cents);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cents, durationMs]);

  return <span className={className}>{fmt(display)}</span>;
}
