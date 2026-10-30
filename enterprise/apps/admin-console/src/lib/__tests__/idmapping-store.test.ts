import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SAMPLE_PROFILE_NAME,
  SAMPLE_RECORDS,
  ensureSampleProfile,
  getSnapshotCompare,
  listConflicts,
  listProfiles,
  mergeAndEnqueue,
  resetIdmappingStoreForTests,
  resolveConflict,
  saveProfile,
} from "../idmapping-store";

describe("idmapping-store", () => {
  const prev = process.env.AGX_DATA_SUITE_STORE_DIR;

  beforeEach(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agx-idmap-"));
    process.env.AGX_DATA_SUITE_STORE_DIR = dir;
    await resetIdmappingStoreForTests();
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.AGX_DATA_SUITE_STORE_DIR;
    else process.env.AGX_DATA_SUITE_STORE_DIR = prev;
  });

  it("seeds sample profile with two fake ID types", async () => {
    const profile = await ensureSampleProfile();
    expect(profile.name).toBe(SAMPLE_PROFILE_NAME);
    expect(profile.id_types.map((t) => t.name).sort()).toEqual(["email", "phone"]);
    const listed = await listProfiles();
    expect(listed.some((p) => p.name === SAMPLE_PROFILE_NAME)).toBe(true);
  });

  it("merge associates + conflict adjudication", async () => {
    await ensureSampleProfile();
    const result = await mergeAndEnqueue(SAMPLE_PROFILE_NAME, SAMPLE_RECORDS);
    expect(result.snapshot_id).toBeTruthy();
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts.some((c) => c.id_type === "email")).toBe(true);

    const phoneRows = result.records.filter((r) => r.phone === "138****0001");
    expect(phoneRows).toHaveLength(2);
    expect(new Set(phoneRows.map((r) => r.subject_id)).size).toBe(1);

    const open = await listConflicts("open");
    expect(open.length).toBeGreaterThan(0);
    const cfl = open[0]!;
    const resolved = await resolveConflict({
      conflict_id: cfl.id,
      decision: "keep_value",
      chosen_value: cfl.values[0],
      note: "人工选择",
    });
    expect(resolved.status).toBe("resolved");
    expect(resolved.decision).toBe("keep_value");

    const stillOpen = await listConflicts("open");
    expect(stillOpen.every((c) => c.id !== cfl.id)).toBe(true);
  });

  it("snapshot compare shows subject delta", async () => {
    await ensureSampleProfile();
    const a = await mergeAndEnqueue(SAMPLE_PROFILE_NAME, [
      { phone: "130****0001", email: "one***@example.com" },
    ]);
    const b = await mergeAndEnqueue(SAMPLE_PROFILE_NAME, [
      { phone: "130****0001", email: "one***@example.com" },
      { phone: "131****0002", email: "two***@example.com" },
    ]);
    const { diff } = await getSnapshotCompare(a.snapshot_id, b.snapshot_id);
    expect(diff.only_right_subject_ids.length).toBeGreaterThanOrEqual(1);
  });

  it("saveProfile requires >=1 id type", async () => {
    await expect(saveProfile({ name: "bad", id_types: [] })).rejects.toThrow(/id_types/);
  });
});
