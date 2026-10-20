// Demo mode only: give each visitor a private session (httpOnly cookie), so judges using the
// public demo at the same time each get their own inbox, payment run and PayPal sandbox ids.
// Outside demo mode this does nothing.

import { NextResponse, type NextRequest } from "next/server";
import { demoMode, isSessionId, newSessionId, SESSION_COOKIE } from "@/lib/session";

export function proxy(request: NextRequest) {
  if (!demoMode() || isSessionId(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  const sid = newSessionId();
  // Make the new session visible to this very request (server components and route handlers
  // read it with cookies()), then set it on the response for the following requests.
  const headers = new Headers(request.headers);
  const others = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((c) => c.trim())
    .filter((c) => c && !c.startsWith(`${SESSION_COOKIE}=`));
  headers.set("cookie", [...others, `${SESSION_COOKIE}=${sid}`].join("; "));
  const response = NextResponse.next({ request: { headers } });
  response.cookies.set(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    // Hosts terminate TLS at their proxy, so trust its forwarded protocol too.
    secure: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}

export const config = {
  // Health checks and static files never get a session.
  matcher: ["/((?!_next/static|_next/image|samples/|icon.svg|favicon.ico|robots.txt|api/health).*)"],
};
