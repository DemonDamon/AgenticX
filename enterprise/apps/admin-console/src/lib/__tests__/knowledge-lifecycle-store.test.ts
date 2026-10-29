import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SAMPLE_KNOWLEDGE_OBJECTS,
  getObject,
  listIssues,
  listObjects,
  listTrail,
  runQualityAndOpenIssues,
  transitionIssue,
  transitionObject,
  upsertObject,
} from "../knowledge-lifecycle-store";

const ORIGINAL_DIR = process.env.AGX_KNOWLEDGE_LIFECYCLE_STORE_DIR;
let tempDir: string;

function restoreEnv() {
  if (ORIGINAL_DIR === undefined) delete process.env.AGX_KNOWLEDGE_LIFECYCLE_STORE_DIR;
  else process.env.AGX_KNOWLEDGE_LIFECYCLE_STORE_DIR = ORIGINAL_DIR;
}

describe("knowledge-lifecycle-store", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "agx-klc-"));
    process.env.AGX_KNOWLEDGE_LIFECYCLE_STORE_DIR = tempDir;
  });

  afterEach(async () => {
    restoreEnv();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("seeds Brand-A samples only", async () => {
    const objects = await listObjects();
    expect(objects.map((o) => o.id)).toEqual(
      [...SAMPLE_KNOWLEDGE_OBJECTS.map((o) => o.id)].sort(),
    );
    const blob = JSON.stringify(objects).toLowerCase();
    expect(blob).toContain("brand-a");
    expect(blob).not.toContain("proposal");
  });

  it("transitions draft → pending_review and records trail", async () => {
    const updated = await transitionObject("brand-a-entity-pump-01", "pending_review", {
      actor: "tester",
    });
    expect(updated.status).toBe("pending_review");
    const trail = await listTrail("brand-a-entity-pump-01");
    expect(trail.some((e) => e.action === "transition" && e.to_status === "pending_review")).toBe(
      true,
    );
  });

  it("rejects illegal object transitions", async () => {
    await expect(transitionObject("brand-a-entity-pump-01", "published")).rejects.toThrow(
      /cannot transition/,
    );
  });

  it("upserts object and bumps version when requested", async () => {
    const created = await upsertObject(
      { id: "brand-a-entity-valve-01", kind: "entity", attrs: { name: "Brand-A Valve 01" } },
      { actor: "tester" },
    );
    expect(created.version).toBe(1);
    const bumped = await upsertObject(
      { id: "brand-a-entity-valve-01", kind: "entity", attrs: { name: "Brand-A Valve 01b" } },
      { actor: "tester", bumpVersion: true },
    );
    expect(bumped.version).toBe(2);
    expect((await getObject("brand-a-entity-valve-01"))?.attrs.name).toBe("Brand-A Valve 01b");
  });

  it("runs quality checks and opens issues; issue transitions work", async () => {
    const { findings, opened } = await runQualityAndOpenIssues();
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.code === "relation_integrity")).toBe(true);
    expect(opened.length).toBeGreaterThan(0);
    const issues = await listIssues();
    expect(issues.length).toBeGreaterThan(0);
    const first = issues[0]!;
    const resolved = await transitionIssue(first.id, "resolved", { actor: "tester" });
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolved_by).toBe("tester");
  });
});
