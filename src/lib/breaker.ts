// A tiny circuit breaker: after a failure, skip the dependency for a while instead of waiting on it
// for every request, then try it again. Used for the demo's Redis state store (state.ts).

export class Breaker {
  private downUntil = 0;
  private readonly retryMs: number;

  constructor(retryMs: number) {
    this.retryMs = retryMs;
  }

  /** The dependency may be used now. */
  up(now = Date.now()): boolean {
    return now >= this.downUntil;
  }

  /** Record a failure. Returns true when this failure opened the breaker (it was up), so callers log once. */
  trip(now = Date.now()): boolean {
    const wasUp = this.up(now);
    this.downUntil = now + this.retryMs;
    return wasUp;
  }

  reset(): void {
    this.downUntil = 0;
  }
}
