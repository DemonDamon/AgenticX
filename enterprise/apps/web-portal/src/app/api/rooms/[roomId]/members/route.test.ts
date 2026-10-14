import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../lib/session", () => ({
  getSessionFromCookies: vi.fn(),
  passwordChangeRequiredResponse: () =>
    Response.json({ code: "40302", message: "password_change_required" }, { status: 403 }),
}));

vi.mock("../../../../../lib/collab-room", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/collab-room")>();
  return {
    ...actual,
    addHumanMember: vi.fn(),
    addAgentMember: vi.fn(),
    listMembers: vi.fn(),
  };
});

vi.mock("@agenticx/iam-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agenticx/iam-core")>();
  return {
    ...actual,
    getAgent: vi.fn(),
    resolveAssignmentKeysForUser: vi.fn(),
  };
});

import type { EnterpriseAgent } from "@agenticx/iam-core";
import { AgentNotFoundError, getAgent, resolveAssignmentKeysForUser } from "@agenticx/iam-core";
import { addAgentMember, addHumanMember } from "../../../../../lib/collab-room";
import { getSessionFromCookies } from "../../../../../lib/session";
import { POST } from "./route";

const session = {
  userId: "01HZX3NDEKTSV4RRFFQ69G5FAV",
  tenantId: "01TENANT0AAAAAAAAAAAAAAA",
  email: "admin@agenticx.local",
  scopes: [],
  sessionId: "sess-1",
  mustChangePassword: false,
};

const ROOM = "01R00M0AAAAAAAAAAAAAAAAAAA";

function params() {
  return { params: Promise.resolve({ roomId: ROOM }) };
}

const agent: EnterpriseAgent = {
  id: "01AGENT0AAAAAAAAAAAAAAAAAA",
  tenantId: session.tenantId,
  slug: "report-bot",
  displayName: "验收助手",
  description: null,
  systemPrompt: "secret",
  model: "demo/reply-model",
  runtime: "cloud",
  capabilityIds: [],
  assignmentKeys: ["all"],
  status: "active",
  metadata: {},
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
};

function agentRequest(agentId: string) {
  return new Request(`http://localhost/api/rooms/${ROOM}/members`, {
    method: "POST",
    body: JSON.stringify({ agent_id: agentId }),
  });
}

describe("POST /api/rooms/:id/members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSessionFromCookies).mockResolvedValue(session);
  });

  it("accepts a login email that is not a ULID", async () => {
    vi.mocked(addHumanMember).mockResolvedValueOnce({
      id: "01MEMBERAAAAAAAAAAAAAAAAAA",
      room_id: ROOM,
      member_type: "human",
      member_id: "user_alice2_agenticx_local",
      display_name: "alice2",
      room_role: "member",
      joined_at: "2026-08-28T00:00:00.000Z",
    });
    const res = await POST(
      new Request(`http://localhost/api/rooms/${ROOM}/members`, {
        method: "POST",
        body: JSON.stringify({ user_id: "alice2@agenticx.local" }),
      }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(addHumanMember).toHaveBeenCalledWith(
      { tenantId: session.tenantId, userId: session.userId },
      ROOM,
      expect.objectContaining({ userId: "alice2@agenticx.local" }),
    );
  });

  it("rejects an empty user_id", async () => {
    const res = await POST(
      new Request(`http://localhost/api/rooms/${ROOM}/members`, {
        method: "POST",
        body: JSON.stringify({ user_id: "   " }),
      }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(addHumanMember).not.toHaveBeenCalled();
  });

  it("returns 400 when the agent does not exist", async () => {
    vi.mocked(getAgent).mockRejectedValueOnce(new AgentNotFoundError());
    const res = await POST(agentRequest(agent.id), params());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("agent not found");
    expect(addAgentMember).not.toHaveBeenCalled();
    expect(addHumanMember).not.toHaveBeenCalled();
  });

  it("returns 400 when the agent is disabled", async () => {
    vi.mocked(getAgent).mockResolvedValueOnce({ ...agent, status: "disabled" });
    const res = await POST(agentRequest(agent.id), params());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("agent disabled");
    expect(addAgentMember).not.toHaveBeenCalled();
  });

  it("returns 403 when the agent is not visible to the caller", async () => {
    vi.mocked(getAgent).mockResolvedValueOnce({ ...agent, assignmentKeys: ["dept:other"] });
    vi.mocked(resolveAssignmentKeysForUser).mockResolvedValueOnce(["all", session.userId]);
    const res = await POST(agentRequest(agent.id), params());
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("agent not visible");
    expect(addAgentMember).not.toHaveBeenCalled();
  });

  it("adds a visible active agent", async () => {
    vi.mocked(getAgent).mockResolvedValueOnce(agent);
    vi.mocked(resolveAssignmentKeysForUser).mockResolvedValueOnce(["all"]);
    vi.mocked(addAgentMember).mockResolvedValueOnce({
      id: "01MEMBERAAAAAAAAAAAAAAAAAA",
      room_id: ROOM,
      member_type: "agent",
      member_id: agent.id,
      display_name: agent.displayName,
      room_role: "member",
      joined_at: "2026-10-14T00:00:00.000Z",
    });
    const res = await POST(agentRequest(agent.id), params());
    expect(res.status).toBe(200);
    expect(addAgentMember).toHaveBeenCalledWith(
      { tenantId: session.tenantId, userId: session.userId },
      ROOM,
      { agentId: agent.id, displayName: agent.displayName },
    );
    expect(addHumanMember).not.toHaveBeenCalled();
    const body = (await res.json()) as { data: { member: { member_type: string } } };
    expect(body.data.member.member_type).toBe("agent");
  });
});
