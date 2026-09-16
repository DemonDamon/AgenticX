import { describe, expect, it } from "vitest";
import { collabRoomErrorResponse, toCollabRoomContext } from "./collab-room-http";
import {
  CollabRoomBadRequestError,
  CollabRoomForbiddenError,
  CollabRoomNotFoundError,
} from "./collab-room/types";

describe("collab-room-http", () => {
  it("maps session to room context", () => {
    expect(
      toCollabRoomContext({
        tenantId: "t1",
        userId: "u1",
        email: "a@example.com",
        scopes: [],
        sessionId: "s1",
        mustChangePassword: false,
      }),
    ).toEqual({ tenantId: "t1", userId: "u1" });
  });

  it("maps Forbidden to 40301", async () => {
    const res = collabRoomErrorResponse(new CollabRoomForbiddenError());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "40301", message: "forbidden" } });
  });

  it("maps NotFound to 40401", async () => {
    const res = collabRoomErrorResponse(new CollabRoomNotFoundError());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "40401", message: "not found" } });
  });

  it("maps BadRequest to 40001", async () => {
    const res = collabRoomErrorResponse(new CollabRoomBadRequestError("content required"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "40001", message: "content required" } });
  });

  it("maps unknown errors to 50001", async () => {
    const res = collabRoomErrorResponse(new Error("boom"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "50001", message: "chat history operation failed" },
    });
  });
});
