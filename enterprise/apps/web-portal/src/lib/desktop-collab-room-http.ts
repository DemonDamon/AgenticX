import { JwtService, type AuthContext } from "@agenticx/auth";
import { insertAuditEvent } from "@agenticx/iam-core";
import { NextResponse } from "next/server";
import { collabRoomErrorResponse } from "./collab-room-http";
import type { CollabRoomContext } from "./collab-room";
import type { DesktopIdentity } from "./desktop-auth";
import { getSessionAuthFromCookies } from "./session";

export function desktopRoomUnauthorized(): NextResponse {
  return NextResponse.json(
    { code: "40101", message: "企业登录已失效，请重新登录" },
    { status: 401 },
  );
}

const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Tenant user ids are ULIDs for new accounts but older seeded accounts use slug ids. */
export function isValidCollabUserId(value: string): boolean {
  return USER_ID_RE.test(value);
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

export async function recordCollabAudit(input: {
  tenantId: string;
  actorUserId: string;
  eventType: string;
  targetKind: "project" | "collab_room";
  targetId?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await insertAuditEvent({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      eventType: input.eventType,
      targetKind: input.targetKind,
      targetId: input.targetId,
      detail: input.detail,
    });
  } catch (error) {
    console.error("[web-portal] insertAuditEvent failed:", input.eventType, error);
  }
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

/**
 * Desktop PAT requests carry no portal cookie, so gateway calls made on their
 * behalf need a short-lived access token signed for the same user.
 */
export async function resolveDesktopGatewayToken(identity: DesktopIdentity): Promise<string | null> {
  try {
    const auth = await getSessionAuthFromCookies();
    if (auth?.accessToken) return auth.accessToken;
  } catch {
    /* ignore */
  }
  try {
    const jwt = new JwtService({
      issuer: "agenticx-enterprise-web-portal",
      audience: "agenticx-web-users",
      accessTtlSeconds: 120,
    });
    const signed = await jwt.signAccessToken(desktopAuthContext(identity));
    return signed.token;
  } catch {
    return null;
  }
}
