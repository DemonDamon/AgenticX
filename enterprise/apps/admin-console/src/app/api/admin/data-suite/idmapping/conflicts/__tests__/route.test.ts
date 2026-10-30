import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SAMPLE_PROFILE_NAME,
  ensureSampleProfile,
  mergeAndEnqueue,
  resetIdmappingStoreForTests,
  SAMPLE_RECORDS,
} from "../../../../../../../lib/idmapping-store";

const requireAdminScopeMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("../../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));

describe("admin data-suite idmapping conflicts route", () => {
  const prev = process.env.AGX_DATA_SUITE_STORE_DIR;

  beforeEach(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agx-idmap-cfl-"));
    process.env.AGX_DATA_SUITE_STORE_DIR = dir;
    await resetIdmappingStoreForTests();
    await ensureSampleProfile();
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

  it("POST merge then GET conflicts then POST resolve", async () => {
    const { POST: mergePost } = await import("../../merge/route");
    const mergeRes = await mergePost(
      new Request("http://localhost/api/admin/data-suite/idmapping/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profile_name: SAMPLE_PROFILE_NAME,
          records: SAMPLE_RECORDS,
        }),
      }),
    );
    expect(mergeRes.status).toBe(200);
    const mergeBody = (await mergeRes.json()) as {
      data: { result: { conflicts: unknown[]; snapshot_id: string } };
    };
    expect(mergeBody.data.result.conflicts.length).toBeGreaterThan(0);

    const { GET, POST } = await import("../route");
    const listRes = await GET(
      new Request("http://localhost/api/admin/data-suite/idmapping/conflicts?status=open"),
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      data: { conflicts: Array<{ id: string; values: unknown[] }> };
    };
    expect(listBody.data.conflicts.length).toBeGreaterThan(0);
    const cfl = listBody.data.conflicts[0]!;

    const resolveRes = await POST(
      new Request("http://localhost/api/admin/data-suite/idmapping/conflicts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conflict_id: cfl.id,
          decision: "keep_value",
          chosen_value: cfl.values[0],
          note: "e2e-adjudicate",
        }),
      }),
    );
    expect(resolveRes.status).toBe(200);
    const resolveBody = (await resolveRes.json()) as {
      data: { conflict: { status: string; decision: string } };
    };
    expect(resolveBody.data.conflict.status).toBe("resolved");
    expect(resolveBody.data.conflict.decision).toBe("keep_value");

    // also exercise direct merge helper for snapshot compare path
    const second = await mergeAndEnqueue(SAMPLE_PROFILE_NAME, [
      { phone: "131****0002", email: "bob***@example.com" },
    ]);
    expect(second.snapshot_id).toBeTruthy();
  });
});
