import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetJobsStoreForTests } from "../../../../../../lib/data-jobs-store";

const requireAdminScopeMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));

describe("admin data-suite jobs route", () => {
  const prev = process.env.AGX_DATA_SUITE_STORE_DIR;

  beforeEach(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agx-jobs-api-"));
    process.env.AGX_DATA_SUITE_STORE_DIR = dir;
    await resetJobsStoreForTests();
    requireAdminScopeMock.mockReset();
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { email: "admin@agenticx.local", userId: "u1", tenantId: "t1" },
    });
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.AGX_DATA_SUITE_STORE_DIR;
    else process.env.AGX_DATA_SUITE_STORE_DIR = prev;
  });

  it("GET returns seeded job + schedule", async () => {
    const { GET } = await import("../route");
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      code: string;
      data: { jobs: Array<{ id: string }>; schedules: Array<{ cron: string }> };
    };
    expect(body.code).toBe("00000");
    expect(body.data.jobs.some((j) => j.id === "golden_path_members")).toBe(true);
    expect(body.data.schedules[0]?.cron).toBe("0 3 * * *");
  });

  it("rejects unauthenticated", async () => {
    requireAdminScopeMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ code: "40300", message: "forbidden" }, { status: 403 }),
    });
    const { GET } = await import("../route");
    const response = await GET();
    expect(response.status).toBe(403);
  });
});
