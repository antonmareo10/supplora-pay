"use client";

// Browser-side fetch helpers: JSON in, JSON out, server errors surfaced as Error messages.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: { paypalIssue?: string; paypalDebugId?: string },
  ) {
    super(message);
  }
}

export async function postJson<T = unknown>(url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Network error: is the app still running?", 0);
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; paypalIssue?: string; paypalDebugId?: string };
  if (!res.ok) throw new ApiError(json.error ?? `Request failed (${res.status})`, res.status, { paypalIssue: json.paypalIssue, paypalDebugId: json.paypalDebugId });
  return json;
}

export async function getJson<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(json.error ?? `Request failed (${res.status})`, res.status);
  return json;
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    return err.detail?.paypalDebugId ? `${err.message} (PayPal debug id ${err.detail.paypalDebugId})` : err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong";
}
