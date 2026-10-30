import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SAMPLE_DISAMBIGUATION_SESSIONS,
  applyResponse,
  getSession,
  listSessions,
  resolveRuntimeStoreDir,
  validateRequest,
} from "../disambiguation-runtime-store";

const ORIGINAL_RUNTIME = process.env.AGX_DISAMBIGUATION_RUNTIME_STORE_DIR;
const ORIGINAL_SHARED = process.env.AGX_DISAMBIGUATION_STORE_DIR;
let tempDir: string;

function restore() {
  if (ORIGINAL_RUNTIME === undefined) delete process.env.AGX_DISAMBIGUATION_RUNTIME_STORE_DIR;
  else process.env.AGX_DISAMBIGUATION_RUNTIME_STORE_DIR = ORIGINAL_RUNTIME;
  if (ORIGINAL_SHARED === undefined) delete process.env.AGX_DISAMBIGUATION_STORE_DIR;
  else process.env.AGX_DISAMBIGUATION_STORE_DIR = ORIGINAL_SHARED;
}

describe("disambiguation-runtime-store", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "agx-daq-portal-"));
    process.env.AGX_DISAMBIGUATION_RUNTIME_STORE_DIR = tempDir;
    delete process.env.AGX_DISAMBIGUATION_STORE_DIR;
  });
  afterEach(async () => {
    restore();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("defaults away from admin store path", () => {
    delete process.env.AGX_DISAMBIGUATION_RUNTIME_STORE_DIR;
    delete process.env.AGX_DISAMBIGUATION_STORE_DIR;
    const dir = resolveRuntimeStoreDir();
    expect(dir.replace(/\\/g, "/")).toContain(".runtime/disambiguation");
    expect(dir.replace(/\\/g, "/")).not.toContain(".runtime/admin/disambiguation");
  });

  it("seeds cooling-loop sessions for all three modes", async () => {
    const sessions = await listSessions();
    expect(sessions.length).toBe(SAMPLE_DISAMBIGUATION_SESSIONS.length);
    const modes = new Set(sessions.flatMap((s) => s.pending.map((p) => p.mode)));
    expect(modes.has("candidate_select")).toBe(true);
    expect(modes.has("info_supplement")).toBe(true);
    expect(modes.has("conflict_resolve")).toBe(true);
    const blob = JSON.stringify(sessions).toLowerCase();
    expect(blob).toContain("cooling-loop");
    expect(blob).not.toContain("proposal");
  });

  it("applies candidate_select and completes session", async () => {
    const updated = await applyResponse("das-cooling-candidate", {
      request_id: "daq-cooling-cand-1",
      selected_ids: ["device-pump-01"],
    });
    expect(updated.status).toBe("completed");
    expect(updated.slots.object).toBe("1号循环泵");
    expect(updated.pending).toHaveLength(0);
    expect((await getSession("das-cooling-candidate"))?.resolved.length).toBe(1);
  });

  it("applies info_supplement free_text", async () => {
    const updated = await applyResponse("das-cooling-supplement", {
      request_id: "daq-cooling-info-1",
      free_text: "值班群",
    });
    expect(updated.status).toBe("completed");
    expect(updated.slots.notify_channel).toBe("值班群");
  });

  it("applies conflict_resolve pick", async () => {
    const updated = await applyResponse("das-cooling-conflict", {
      request_id: "daq-cooling-conf-1",
      selected_ids: ["zone-cooling-1"],
    });
    expect(updated.status).toBe("completed");
    expect(updated.slots.site_name).toBe("一车间冷却区");
  });

  it("rejects invalid candidate pick", async () => {
    await expect(
      applyResponse("das-cooling-candidate", {
        request_id: "daq-cooling-cand-1",
        selected_ids: ["not-a-real-id"],
      }),
    ).rejects.toThrow(/unknown selected_ids/);
  });

  it("validateRequest enforces mode invariants", () => {
    expect(() =>
      validateRequest({
        id: "x",
        mode: "candidate_select",
        prompt: "p",
        candidates: [],
        conflicts: [],
      }),
    ).toThrow(/candidate_select/);
  });
});
