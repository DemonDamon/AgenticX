import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SAMPLE_DISAMBIGUATION_SESSIONS,
  applyResponse,
  getSession,
  listSessions,
  validateRequest,
} from "../disambiguation-store";

const ORIGINAL = process.env.AGX_DISAMBIGUATION_STORE_DIR;
let tempDir: string;

function restore() {
  if (ORIGINAL === undefined) delete process.env.AGX_DISAMBIGUATION_STORE_DIR;
  else process.env.AGX_DISAMBIGUATION_STORE_DIR = ORIGINAL;
}

describe("disambiguation-store", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "agx-daq-"));
    process.env.AGX_DISAMBIGUATION_STORE_DIR = tempDir;
  });
  afterEach(async () => {
    restore();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("seeds Brand-A sessions for all three modes", async () => {
    const sessions = await listSessions();
    expect(sessions.length).toBe(SAMPLE_DISAMBIGUATION_SESSIONS.length);
    const modes = new Set(
      sessions.flatMap((s) => s.pending.map((p) => p.mode)),
    );
    expect(modes.has("candidate_select")).toBe(true);
    expect(modes.has("info_supplement")).toBe(true);
    expect(modes.has("conflict_resolve")).toBe(true);
    const blob = JSON.stringify(sessions).toLowerCase();
    expect(blob).toContain("brand-a");
    expect(blob).not.toContain("proposal");
  });

  it("applies candidate_select and completes session", async () => {
    const updated = await applyResponse("das-brand-a-candidate", {
      request_id: "daq-brand-a-cand-1",
      selected_ids: ["brand-a-pump-01"],
    });
    expect(updated.status).toBe("completed");
    expect(updated.slots.object).toBe("Brand-A Pump 01");
    expect(updated.pending).toHaveLength(0);
    expect((await getSession("das-brand-a-candidate"))?.resolved.length).toBe(1);
  });

  it("applies info_supplement free_text", async () => {
    const updated = await applyResponse("das-brand-a-supplement", {
      request_id: "daq-brand-a-info-1",
      free_text: "ops-channel-brand-a",
    });
    expect(updated.status).toBe("completed");
    expect(updated.slots.notify_channel).toBe("ops-channel-brand-a");
  });

  it("rejects invalid candidate pick", async () => {
    await expect(
      applyResponse("das-brand-a-candidate", {
        request_id: "daq-brand-a-cand-1",
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
