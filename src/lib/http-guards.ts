// Request guards shared by every write route: same-origin protection, JSON bodies with a size cap,
// and euro amounts parsed into integer cents within bounds.
//
// Pure (no Node or Next APIs beyond the standard Request), so the guards are unit-tested with Node's
// test runner (http-guards.test.ts). http.ts re-exports them for the route handlers.

export class HttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Reject cross-site writes: a payments app must not be drivable from another origin. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return; // same-origin fetches from older browsers / curl
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw new HttpError("Cross-origin request rejected.", 403);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError("Invalid origin.", 403);
  }
}

export async function readJson<T = Record<string, unknown>>(request: Request, maxBytes = 32_000): Promise<T> {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError("Request body too large.", 413);
  if (!text) return {} as T;
  try {
    const value = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    return value as T;
  } catch {
    throw new HttpError("Invalid JSON body.", 400);
  }
}

export function eurosToCents(value: unknown, { min, max }: { min: number; max: number }): number {
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new HttpError("Enter an amount in euros.", 400);
  const cents = Math.round(n * 100);
  if (cents < min * 100 || cents > max * 100) throw new HttpError(`Amount must be between €${min} and €${max.toLocaleString("en")}.`, 400);
  return cents;
}
