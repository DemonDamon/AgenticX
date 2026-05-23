import { NextResponse } from "next/server";
import { getGatewayInternalToken } from "./gateway-internal-token";

export function gatewayInternalUnauthorized(): NextResponse {
  return NextResponse.json({ code: "40101", message: "unauthorized" }, { status: 401 });
}

export function isGatewayInternalAuthorized(request: Request): boolean {
  const expected = getGatewayInternalToken();
  if (!expected) return false;
  const auth = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+([\s\S]+)$/i.exec(auth);
  const token = m?.[1]?.trim();
  return !!token && token === expected;
}
