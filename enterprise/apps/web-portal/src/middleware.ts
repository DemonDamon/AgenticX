import { NextResponse } from "next/server";
import { resolveHstsHeader } from "./lib/hsts";

export function middleware() {
  const response = NextResponse.next();
  const hsts = resolveHstsHeader();
  if (hsts) response.headers.set("Strict-Transport-Security", hsts);
  return response;
}

// Next 15 routes middleware to the Node.js server when config.runtime is "nodejs",
// so PORTAL_HSTS_MAX_AGE is read from the process environment at request time.
export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static/|_next/image|favicon.ico).*)"],
};
