// Public demo (DEMO_MODE): caps on PayPal sandbox writes, so an open URL cannot be used to hammer the
// sandbox app or drain its test balance. Sliding one-hour window, kept in process memory.
//
//  - per visitor session: one full click-through of the demo makes about ten writes;
//  - per client IP: a visitor who clears cookies gets a new session but keeps their IP;
//  - in total: the hard bound, whatever the headers say (IP headers can be spoofed on some hosts).
//
// Pure (no Node or Next APIs) so it can be unit-tested with Node's test runner.

export interface WriteLimits {
  perSession: number;
  perIp: number;
  total: number;
  windowMs: number;
}

export const DEMO_WRITE_LIMITS: WriteLimits = { perSession: 40, perIp: 120, total: 400, windowMs: 3_600_000 };

export const UNKNOWN_IP = "unknown";

export type WriteDecision = { ok: true } | { ok: false; scope: "session" | "ip" | "total" };

export class WriteLimiter {
  private log: { at: number; session: string; ip: string }[] = [];
  private readonly limits: WriteLimits;

  constructor(limits: WriteLimits = DEMO_WRITE_LIMITS) {
    this.limits = limits;
  }

  /** Counts the write and returns ok, or returns which cap it would break (and does not count it). */
  take(session: string, ip: string, now = Date.now()): WriteDecision {
    const since = now - this.limits.windowMs;
    while (this.log.length && this.log[0].at <= since) this.log.shift();
    if (this.log.length >= this.limits.total) return { ok: false, scope: "total" };
    let bySession = 0;
    let byIp = 0;
    for (const w of this.log) {
      if (w.session === session) bySession++;
      if (w.ip === ip) byIp++;
    }
    if (bySession >= this.limits.perSession) return { ok: false, scope: "session" };
    // Without a client IP (e.g. a local run) only the session and total caps apply.
    if (ip !== UNKNOWN_IP && byIp >= this.limits.perIp) return { ok: false, scope: "ip" };
    this.log.push({ at: now, session, ip });
    return { ok: true };
  }
}
