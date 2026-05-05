import { promises as fs } from "node:fs";
import path from "node:path";
import type { PolicySnapshot } from "../types";

type SnapshotStore = {
  updatedAt: string;
  tenants: Record<string, PolicySnapshot>;
};

function resolveEnterpriseRoot(): string {
  const cwd = process.cwd();
  if (cwd.endsWith("/enterprise")) return cwd;
  if (cwd.includes("/enterprise/")) {
    return cwd.slice(0, cwd.indexOf("/enterprise/") + "/enterprise".length);
  }
  return path.resolve(cwd, "../..");
}

export function resolveSnapshotPath(): string {
  const fallback = path.join(resolveEnterpriseRoot(), ".runtime/admin/policy-snapshot.json");
  return process.env.ENTERPRISE_POLICY_SNAPSHOT_FILE || fallback;
}

async function readStore(filePath: string): Promise<SnapshotStore> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<SnapshotStore>;
    if (parsed && typeof parsed === "object" && parsed.tenants && typeof parsed.tenants === "object") {
      return {
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
        tenants: parsed.tenants as Record<string, PolicySnapshot>,
      };
    }
  } catch {
    // ignore
  }
  return { updatedAt: new Date().toISOString(), tenants: {} };
}

export async function writeSnapshot(snapshot: PolicySnapshot): Promise<string> {
  const filePath = resolveSnapshotPath();
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const store = await readStore(filePath);
  store.updatedAt = new Date().toISOString();
  store.tenants[snapshot.tenantId] = snapshot;

  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(store, null, 2), { mode: 0o600 });
  await fs.rename(tmpPath, filePath);
  return filePath;
}

export async function readTenantSnapshot(tenantId: string): Promise<PolicySnapshot | null> {
  const store = await readStore(resolveSnapshotPath());
  return store.tenants[tenantId] ?? null;
}
