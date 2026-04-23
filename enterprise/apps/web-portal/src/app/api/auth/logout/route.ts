import { NextResponse } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../../../../lib/session";

export async function POST() {
  const response = NextResponse.json({ code: "00000", message: "ok" });
  response.cookies.set(ACCESS_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}

