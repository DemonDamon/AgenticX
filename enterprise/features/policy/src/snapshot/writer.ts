import { promises as fs } from "node:fs";
import path from "node:path";
import type { PolicySnapshot } from "../types";

type SnapshotStore = {
  updatedAt: string;
  tenants: Record<string, PolicySnapshot>;
};

const SNAPSHOT_LOCK_RETRY_MS = 25;
const SNAPSHOT_LOCK_MAX_RETRY = 200;

type ReplaceSnapshotOptions = {
  expectedCurrentPublishId?: string | null;
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
  return (
    process.env.ENTERPRISE_POLICY_SNAPSHOT_FILE ||
    process.env.GATEWAY_POLICY_SNAPSHOT_FILE ||
    fallback
  );
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
    throw new Error("Invalid snapshot store shape");
  } catch (error) {
    const maybe = error as NodeJS.ErrnoException;
    if (maybe?.code === "ENOENT") {
      return { updatedAt: new Date().toISOString(), tenants: {} };
    }
    throw new Error(`snapshot read failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withSnapshotLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = `${filePath}.lock`;
  for (let i = 0; i < SNAPSHOT_LOCK_MAX_RETRY; i++) {
    try {
      await fs.mkdir(lockPath, { mode: 0o700 });
      try {
        return await fn();
      } finally {
        await fs.rm(lockPath, { recursive: true, force: true });
      }
    } catch (error) {
      const maybe = error as NodeJS.ErrnoException;
      if (maybe?.code !== "EEXIST") {
        throw error;
      }
      await sleep(SNAPSHOT_LOCK_RETRY_MS);
    }
  }
  throw new Error("snapshot lock timeout");
}

export async function replaceTenantSnapshot(
  tenantId: string,
  snapshot: PolicySnapshot | null,
  options?: ReplaceSnapshotOptions
): Promise<string> {
  const filePath = resolveSnapshotPath();
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  await withSnapshotLock(filePath, async () => {
    const store = await readStore(filePath);
    if (options && "expectedCurrentPublishId" in options) {
      const current = store.tenants[tenantId] ?? null;
      const currentPublishId = current?.publishId ?? null;
      if (currentPublishId !== (options.expectedCurrentPublishId ?? null)) {
        throw new Error("snapshot CAS mismatch");
      }
    }
    store.updatedAt = new Date().toISOString();
    if (snapshot) {
      store.tenants[tenantId] = snapshot;
    } else {
      delete store.tenants[tenantId];
    }

    const tmpPath = `${filePath}.tmp.${process.pid}`;
    await fs.writeFile(tmpPath, JSON.stringify(store, null, 2), { mode: 0o600 });
    await fs.rename(tmpPath, filePath);
  });
  return filePath;
}

export async function writeSnapshot(snapshot: PolicySnapshot): Promise<string> {
  return replaceTenantSnapshot(snapshot.tenantId, snapshot);
}

export async function writeSnapshotWithCas(
  snapshot: PolicySnapshot,
  expectedCurrentPublishId: string | null
): Promise<string> {
  return replaceTenantSnapshot(snapshot.tenantId, snapshot, { expectedCurrentPublishId });
}

export async function readTenantSnapshot(tenantId: string): Promise<PolicySnapshot | null> {
  const store = await readStore(resolveSnapshotPath());
  return store.tenants[tenantId] ?? null;
}
