import { beforeEach, describe, expect, it, vi } from "vitest";

const recordSkillScan = vi.fn();
const requireAdminScope = vi.fn();

vi.mock("../../../../../../../lib/capability-packs-store", () => ({
  recordSkillScan: (...args: unknown[]) => recordSkillScan(...args),
}));
vi.mock("../../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScope(...args),
}));

import { PUT } from "../route";

function request(body: unknown): Request {
  return new Request("https://admin.example.com/api/admin/skills/sk_1/scan", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: "sk_1" });

describe("PUT /api/admin/skills/:id/scan", () => {
  beforeEach(() => {
    recordSkillScan.mockReset();
    requireAdminScope.mockReset();
    requireAdminScope.mockResolvedValue({
      ok: true,
      session: { email: "admin@example.com", userId: "u_1" },
    });
    recordSkillScan.mockResolvedValue({ id: "sk_1", scanVerdict: "caution" });
  });

  it("records a verdict together with the source it was scanned under", async () => {
    const res = await PUT(
      request({ verdict: "caution", source: "community", findings: [{ rule: "exfiltration" }] }),
      { params },
    );
    expect(res.status).toBe(200);
    expect(recordSkillScan).toHaveBeenCalledWith("sk_1", {
      verdict: "caution",
      source: "community",
      findings: [{ rule: "exfiltration" }],
      scannedBy: "admin@example.com",
    });
  });

  it("rejects a verdict the scanner never produces", async () => {
    const res = await PUT(request({ verdict: "totally-fine", source: "community" }), { params });
    expect(res.status).toBe(400);
    expect(recordSkillScan).not.toHaveBeenCalled();
  });

  it("requires the source, because the same package scans differently under each", async () => {
    // community 和 trusted 扫同一个包，放行判断不一样；不记来源的结论没法解释。
    const res = await PUT(request({ verdict: "safe" }), { params });
    expect(res.status).toBe(400);
    expect(recordSkillScan).not.toHaveBeenCalled();
  });

  it("takes the scanner identity from the session, never from the request body", async () => {
    // 留痕能被请求体改写的话，等于谁都能签别人的名。
    await PUT(
      request({ verdict: "safe", source: "community", scannedBy: "someone-else@example.com" }),
      { params },
    );
    expect(recordSkillScan.mock.calls[0]?.[1]).toMatchObject({ scannedBy: "admin@example.com" });
  });

  it("drops a findings payload that is not a list", async () => {
    await PUT(request({ verdict: "safe", source: "community", findings: "oops" }), { params });
    expect(recordSkillScan.mock.calls[0]?.[1]).toMatchObject({ findings: [] });
  });
});
