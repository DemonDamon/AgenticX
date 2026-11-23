export interface VirtualModelTarget {
  model: string;
  weight: number;
  priority: number;
}

export interface VirtualModelRecord {
  id: string;
  tenantId: string;
  name: string;
  displayName: string;
  enabled: boolean;
  targets: VirtualModelTarget[];
  createdAt: string;
  updatedAt: string;
}

export interface VirtualModelInput {
  name: string;
  displayName: string;
  enabled: boolean;
  targets: VirtualModelTarget[];
}

const namePattern = /^[A-Za-z0-9._:-]+$/;

export function validateVirtualModelInput(raw: {
  name?: unknown;
  displayName?: unknown;
  enabled?: unknown;
  targets?: unknown;
}): VirtualModelInput {
  if (typeof raw.name !== "string") throw new Error("name is invalid");
  const name = raw.name.trim();
  if (!namePattern.test(name) || name.length > 128) throw new Error("name is invalid");

  if (typeof raw.displayName !== "string") throw new Error("displayName is invalid");
  const displayName = raw.displayName.trim();
  if (!displayName || displayName.length > 256) throw new Error("displayName is invalid");

  let enabled = true;
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== "boolean") throw new Error("enabled is invalid");
    enabled = raw.enabled;
  }

  if (!Array.isArray(raw.targets) || raw.targets.length < 1 || raw.targets.length > 20) {
    throw new Error("targets is invalid");
  }
  const seen = new Set<string>();
  const targets: VirtualModelTarget[] = raw.targets.map((item) => {
    if (!item || typeof item !== "object") throw new Error("targets is invalid");
    const row = item as { model?: unknown; weight?: unknown; priority?: unknown };
    if (typeof row.model !== "string") throw new Error("targets is invalid");
    const model = row.model.trim();
    if (!namePattern.test(model) || model.length > 128) throw new Error("targets is invalid");
    if (seen.has(model)) throw new Error("duplicate target model");
    seen.add(model);
    if (typeof row.weight !== "number" || !Number.isInteger(row.weight) || row.weight < 1) {
      throw new Error("targets is invalid");
    }
    let priority = 0;
    if (row.priority !== undefined) {
      if (typeof row.priority !== "number" || !Number.isInteger(row.priority)) {
        throw new Error("targets is invalid");
      }
      priority = row.priority;
    }
    return { model, weight: row.weight, priority };
  });

  return { name, displayName, enabled, targets };
}

export function requiredTenantId(): string {
  const tenantId = process.env.DEFAULT_TENANT_ID?.trim();
  if (!tenantId) throw new Error("DEFAULT_TENANT_ID is required");
  return tenantId;
}

export function timeText(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return "";
}

export function parseTargets(raw: unknown): VirtualModelTarget[] {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { model?: unknown; weight?: unknown; priority?: unknown };
    if (typeof row.model !== "string") return [];
    const weight = typeof row.weight === "number" ? row.weight : 1;
    const priority = typeof row.priority === "number" ? row.priority : 0;
    return [{ model: row.model, weight, priority }];
  });
}
