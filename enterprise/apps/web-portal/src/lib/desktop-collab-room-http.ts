import type { AuthContext } from "@agenticx/auth";
import { NextResponse } from "next/server";
import { collabRoomErrorResponse } from "./collab-room-http";
import type { CollabRoomContext } from "./collab-room";
import type { DesktopIdentity } from "./desktop-auth";

export function desktopRoomUnauthorized(): NextResponse {
  return NextResponse.json(
    { code: "40101", message: "企业登录已失效，请重新登录" },
    { status: 401 },
  );
}

export function desktopRoomContext(identity: DesktopIdentity): CollabRoomContext {
  return { tenantId: identity.tenantId, userId: identity.userId };
}

export function desktopRoomErrorResponse(error: unknown) {
  return collabRoomErrorResponse(error);
}

export function desktopSenderName(identity: DesktopIdentity): string {
  return identity.displayName?.trim() || identity.email?.trim() || identity.userId;
}

export function desktopAuthContext(identity: DesktopIdentity): AuthContext {
  return {
    userId: identity.userId,
    tenantId: identity.tenantId,
    deptId: identity.deptId,
    email: identity.email,
    scopes: identity.scopes,
    sessionId: `desktop-pat-${identity.tokenId}`,
    mustChangePassword: false,
  };
}
