import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../../../../lib/admin-session";

export async function POST() {
  const response = NextResponse.json({ code: "00000", message: "ok" });
  response.cookies.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

