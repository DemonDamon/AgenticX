import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SAMPLE_PROFILE_NAME,
  resetIdmappingStoreForTests,
} from "../../../../../../../lib/idmapping-store";

const requireAdminScopeMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("../../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));

describe("admin data-suite idmapping profiles route", () => {
  const prev = process.env.AGX_DATA_SUITE_STORE_DIR;

  beforeEach(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agx-idmap-api-"));
    process.env.AGX_DATA_SUITE_STORE_DIR = dir;
    await resetIdmappingStoreForTests();
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

  it("GET seeds sample profile", async () => {
    const { GET } = await import("../route");
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      code: string;
      data: { profiles: Array<{ name: string; id_types: Array<{ name: string }> }> };
    };
    expect(body.code).toBe("00000");
    const sample = body.data.profiles.find((p) => p.name === SAMPLE_PROFILE_NAME);
    expect(sample).toBeTruthy();
    expect(sample!.id_types.map((t) => t.name).sort()).toEqual(["email", "phone"]);
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
