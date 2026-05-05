import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readTenantSnapshot, replaceTenantSnapshot, writeSnapshot, writeSnapshotWithCas } from "../src/snapshot/writer";
import type { PolicySnapshot } from "../src/types";

function makeSnapshot(tenantId: string, version: number): PolicySnapshot {
  return {
    tenantId,
    version,
    publishedAt: new Date().toISOString(),
    publisher: "tester",
    deptIndex: {},
    packs: [],
  };
}

describe("snapshot writer", () => {
  const oldSnapshotPath = process.env.ENTERPRISE_POLICY_SNAPSHOT_FILE;

  afterEach(async () => {
    if (oldSnapshotPath === undefined) {
      delete process.env.ENTERPRISE_POLICY_SNAPSHOT_FILE;
    } else {
      process.env.ENTERPRISE_POLICY_SNAPSHOT_FILE = oldSnapshotPath;
    }
  });

  it("writes and reads tenant snapshot", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "policy-snapshot-"));
    process.env.ENTERPRISE_POLICY_SNAPSHOT_FILE = path.join(dir, "policy-snapshot.json");

    await writeSnapshot(makeSnapshot("tenant-a", 1));
    const snapshot = await readTenantSnapshot("tenant-a");
    expect(snapshot?.version).toBe(1);
  });

  it("removes tenant snapshot when replacing with null", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "policy-snapshot-"));
    process.env.ENTERPRISE_POLICY_SNAPSHOT_FILE = path.join(dir, "policy-snapshot.json");

    await writeSnapshot(makeSnapshot("tenant-a", 1));
    await replaceTenantSnapshot("tenant-a", null);
    const snapshot = await readTenantSnapshot("tenant-a");
    expect(snapshot).toBeNull();
  });

  it("throws for corrupted snapshot file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "policy-snapshot-"));
    const target = path.join(dir, "policy-snapshot.json");
    process.env.ENTERPRISE_POLICY_SNAPSHOT_FILE = target;
    await fs.writeFile(target, "{not-valid-json", "utf-8");

    await expect(writeSnapshot(makeSnapshot("tenant-a", 1))).rejects.toThrowError(/snapshot/i);
  });

  it("fails CAS write when baseline publishId mismatches", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "policy-snapshot-"));
    process.env.ENTERPRISE_POLICY_SNAPSHOT_FILE = path.join(dir, "policy-snapshot.json");

    await writeSnapshot({
      ...makeSnapshot("tenant-a", 1),
      publishId: "pub-1",
    });
    await expect(
      writeSnapshotWithCas(
        {
          ...makeSnapshot("tenant-a", 2),
          publishId: "pub-2",
        },
        "other-publish-id"
      )
    ).rejects.toThrowError(/CAS mismatch/);
  });
});
