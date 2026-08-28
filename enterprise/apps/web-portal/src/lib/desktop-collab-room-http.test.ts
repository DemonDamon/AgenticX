import { describe, expect, it } from "vitest";
import {
  desktopAuthContext,
  desktopRoomContext,
  desktopRoomErrorResponse,
  desktopRoomUnauthorized,
  desktopSenderName,
} from "./desktop-collab-room-http";
import { CollabRoomForbiddenError } from "./collab-room/types";
import type { DesktopIdentity } from "./desktop-auth";

const IDENTITY: DesktopIdentity = {
  userId: "01HZX3NDEKTSV4RRFFQ69G5FAV",
  tenantId: "01TENANT0AAAAAAAAAAAAAAA",
  deptId: null,
  email: "bob@example.com",
  displayName: "Bob",
  tokenId: 42,
  scopes: ["workspace:chat", "desktop:managed"],
};

describe("desktop-collab-room-http", () => {
  it("returns 40101 when unauthorized", async () => {
    const res = desktopRoomUnauthorized();
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      code: "40101",
      message: "企业登录已失效，请重新登录",
    });
  });

  it("maps identity to room context", () => {
    expect(desktopRoomContext(IDENTITY)).toEqual({
      tenantId: IDENTITY.tenantId,
      userId: IDENTITY.userId,
    });
  });

  it("prefers display name then email then user id", () => {
    expect(desktopSenderName(IDENTITY)).toBe("Bob");
    expect(desktopSenderName({ ...IDENTITY, displayName: "  " })).toBe("bob@example.com");
    expect(desktopSenderName({ ...IDENTITY, displayName: "", email: "" })).toBe(IDENTITY.userId);
  });

  it("builds AuthContext with a desktop-pat session id", () => {
    expect(desktopAuthContext(IDENTITY)).toEqual({
      userId: IDENTITY.userId,
      tenantId: IDENTITY.tenantId,
      deptId: null,
      email: IDENTITY.email,
      scopes: IDENTITY.scopes,
      sessionId: "desktop-pat-42",
      mustChangePassword: false,
    });
  });

  it("maps store errors with the cookie-side codes", async () => {
    const res = desktopRoomErrorResponse(new CollabRoomForbiddenError());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "40301", message: "forbidden" } });
  });
});
