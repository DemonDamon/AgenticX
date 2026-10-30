import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetJobsStoreForTests } from "../../../../../../../lib/data-jobs-store";

const requireAdminScopeMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("../../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));

describe("admin data-suite jobs runs route", () => {
  const prev = process.env.AGX_DATA_SUITE_STORE_DIR;

  beforeEach(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agx-jobs-runs-"));
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

  it("POST tick then GET history then POST rerun", async () => {
    const { POST, GET } = await import("../route");
    const tickRes = await POST(
      new Request("http://localhost/api/admin/data-suite/jobs/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "tick" }),
      }),
    );
    expect(tickRes.status).toBe(200);
    const tickBody = (await tickRes.json()) as {
      data: { runs: Array<{ status: string; snapshot_id: string | null }> };
    };
    expect(tickBody.data.runs[0]?.status).toBe("succeeded");
    const snap = tickBody.data.runs[0]?.snapshot_id;
    expect(snap).toBeTruthy();

    const listRes = await GET(
      new Request("http://localhost/api/admin/data-suite/jobs/runs?job_id=golden_path_members"),
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { data: { runs: unknown[] } };
    expect(listBody.data.runs.length).toBeGreaterThanOrEqual(1);

    const rerunRes = await POST(
      new Request("http://localhost/api/admin/data-suite/jobs/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "rerun", job_id: "golden_path_members" }),
      }),
    );
    expect(rerunRes.status).toBe(200);
    const rerunBody = (await rerunRes.json()) as {
      data: { run: { trigger: string; status: string } };
    };
    expect(rerunBody.data.run.trigger).toBe("manual");
    expect(rerunBody.data.run.status).toBe("succeeded");

    const replayRes = await POST(
      new Request("http://localhost/api/admin/data-suite/jobs/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "replay",
          job_id: "golden_path_members",
          snapshot_id: snap,
        }),
      }),
    );
    expect(replayRes.status).toBe(200);
  });

  it("rejects unknown action", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/admin/data-suite/jobs/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "nope" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
