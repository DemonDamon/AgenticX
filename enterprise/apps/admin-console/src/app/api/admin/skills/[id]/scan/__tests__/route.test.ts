import { beforeEach, describe, expect, it, vi } from "vitest";

const recordSkillScan = vi.fn();
const getSkill = vi.fn();
const requireAdminScope = vi.fn();
const scanSkillViaRegistry = vi.fn();

vi.mock("../../../../../../../lib/capability-packs-store", () => ({
  recordSkillScan: (...args: unknown[]) => recordSkillScan(...args),
  getSkill: (...args: unknown[]) => getSkill(...args),
}));
vi.mock("../../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScope(...args),
}));
vi.mock("../../../../../../../lib/skill-registry-scan", () => ({
  scanSkillViaRegistry: (...args: unknown[]) => scanSkillViaRegistry(...args),
}));

import { POST, PUT } from "../route";

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
    const res = await PUT(request({ verdict: "safe" }), { params });
    expect(res.status).toBe(400);
    expect(recordSkillScan).not.toHaveBeenCalled();
  });

  it("takes the scanner identity from the session, never from the request body", async () => {
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

describe("POST /api/admin/skills/:id/scan", () => {
  beforeEach(() => {
    recordSkillScan.mockReset();
    getSkill.mockReset();
    scanSkillViaRegistry.mockReset();
    requireAdminScope.mockReset();
    requireAdminScope.mockResolvedValue({
      ok: true,
      session: { email: "admin@example.com", userId: "u_1" },
    });
    getSkill.mockResolvedValue({ id: "sk_1", slug: "research" });
    scanSkillViaRegistry.mockResolvedValue({
      verdict: "safe",
      findings: [],
      source: "community",
    });
    recordSkillScan.mockResolvedValue({ id: "sk_1", scanVerdict: "safe" });
  });

  it("asks the existing registry to scan, then writes the verdict", async () => {
    const res = await POST(new Request("https://admin.example.com/api/admin/skills/sk_1/scan"), {
      params,
    });
    expect(res.status).toBe(200);
    expect(scanSkillViaRegistry).toHaveBeenCalledWith("research");
    expect(recordSkillScan).toHaveBeenCalledWith("sk_1", {
      verdict: "safe",
      source: "community",
      findings: [],
      scannedBy: "admin@example.com",
    });
  });

  it("does not write a verdict when the registry call fails", async () => {
    scanSkillViaRegistry.mockRejectedValue(new Error("skill-registry scan failed: HTTP 503"));
    const res = await POST(new Request("https://admin.example.com/api/admin/skills/sk_1/scan"), {
      params,
    });
    expect(res.status).toBe(503);
    expect(recordSkillScan).not.toHaveBeenCalled();
  });
});
