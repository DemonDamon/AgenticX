import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();
const publishEmployeeAgentVersion = vi.fn();

vi.mock("../../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

vi.mock("../../../../../../lib/desktop-agent-publish", () => ({
  publishEmployeeAgentVersion: (...args: unknown[]) => publishEmployeeAgentVersion(...args),
}));

const validBody = {
  local_avatar_id: "avatar-1",
  display_name: "周报助手",
  description: "整理周报",
  manifest: { schema: "agx.agent/v1" },
  note: "第一次提交",
};

function post(body: unknown) {
  return import("../route").then(({ POST }) =>
    POST(
      new Request("http://localhost/api/desktop/agents/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  );
}

describe("POST /api/desktop/agents/publish", () => {
  beforeEach(() => {
    resolveDesktopIdentity.mockReset().mockResolvedValue({ tenantId: "t1", userId: "u1" });
    publishEmployeeAgentVersion.mockReset();
  });

  it("401 without identity", async () => {
    resolveDesktopIdentity.mockResolvedValue(null);
    const res = await post(validBody);
    expect(res.status).toBe(401);
    expect(publishEmployeeAgentVersion).not.toHaveBeenCalled();
  });

  it("400 on unknown field", async () => {
    const res = await post({ ...validBody, surprise: true });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("40000");
    expect(json.message).toContain("未知字段：surprise");
    expect(publishEmployeeAgentVersion).not.toHaveBeenCalled();
  });

  it("400 on bad local_avatar_id", async () => {
    const res = await post({ ...validBody, local_avatar_id: "bad id" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("40000");
    expect(publishEmployeeAgentVersion).not.toHaveBeenCalled();
  });

  it("maps invalid to 400 with errors", async () => {
    publishEmployeeAgentVersion.mockResolvedValue({
      kind: "invalid",
      errors: ["manifest.model: is required"],
    });
    const res = await post(validBody);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "40001",
      message: "manifest is invalid",
      errors: ["manifest.model: is required"],
    });
  });

  it("maps recalled to 409 40900", async () => {
    publishEmployeeAgentVersion.mockResolvedValue({ kind: "recalled" });
    const res = await post(validBody);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "40900",
      message: "该智能体已被管理员回收，无法再次提交",
    });
  });
});
