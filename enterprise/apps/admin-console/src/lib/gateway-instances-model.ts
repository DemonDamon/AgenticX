export const HEARTBEAT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const CORE_DOMAINS = ["providers", "channels", "policy", "mcp_servers"] as const;

export type CoreDomain = (typeof CORE_DOMAINS)[number];

export type HeartbeatDomain = {
  domain: CoreDomain;
  appliedAt: string;
  version: string;
  lastError: string;
  contentHash: string;
  checkedAt: string;
  consecutiveFailures: number;
};

export type HeartbeatStatus = {
  instanceId: string;
  startedAt: string;
  domains: HeartbeatDomain[];
};

export type GatewayInstanceRow = {
  instanceId: string;
  tenantScope: string;
  lastSeenAt: Date;
  statusJson: HeartbeatStatus;
  updatedAt: Date;
};

export type HeartbeatWrite = {
  instanceId: string;
  tenantScope: string;
  startedAt: string;
  domains: HeartbeatDomain[];
};

export type GatewayInstanceRepository = {
  upsert(row: GatewayInstanceRow): Promise<void>;
  deleteLastSeenBefore(cutoff: Date): Promise<void>;
  list(): Promise<GatewayInstanceRow[]>;
};

function emptyDomain(domain: CoreDomain): HeartbeatDomain {
  return {
    domain,
    appliedAt: "",
    version: "",
    lastError: "",
    contentHash: "",
    checkedAt: "",
    consecutiveFailures: 0,
  };
}

function asCoreDomain(value: string): CoreDomain | null {
  for (const domain of CORE_DOMAINS) {
    if (domain === value) return domain;
  }
  return null;
}

export function parseHeartbeatBody(raw: unknown): HeartbeatWrite | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const instanceId = typeof body.instanceId === "string" ? body.instanceId.trim() : "";
  if (!instanceId || instanceId.length > 255) return null;
  const tenantScopeRaw = typeof body.tenantScope === "string" ? body.tenantScope.trim() : "";
  const startedAt = typeof body.startedAt === "string" ? body.startedAt.slice(0, 64) : "";
  const by = new Map<CoreDomain, HeartbeatDomain>();
  if (Array.isArray(body.domains)) {
    for (const item of body.domains) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const domain = asCoreDomain(typeof record.domain === "string" ? record.domain : "");
      if (!domain) continue;
      const failures = record.consecutiveFailures;
      by.set(domain, {
        domain,
        appliedAt: typeof record.appliedAt === "string" ? record.appliedAt : "",
        version: typeof record.version === "string" ? record.version : "",
        lastError: typeof record.lastError === "string" ? record.lastError.slice(0, 1000) : "",
        contentHash: typeof record.contentHash === "string" ? record.contentHash : "",
        checkedAt: typeof record.checkedAt === "string" ? record.checkedAt : "",
        consecutiveFailures: typeof failures === "number" && Number.isFinite(failures) ? failures : 0,
      });
    }
  }
  return {
    instanceId,
    tenantScope: tenantScopeRaw.slice(0, 255),
    startedAt,
    domains: CORE_DOMAINS.map((domain) => by.get(domain) ?? emptyDomain(domain)),
  };
}

export function heartbeatRow(input: HeartbeatWrite, now: Date): GatewayInstanceRow {
  return {
    instanceId: input.instanceId,
    tenantScope: input.tenantScope,
    lastSeenAt: now,
    updatedAt: now,
    statusJson: {
      instanceId: input.instanceId,
      startedAt: input.startedAt,
      domains: input.domains,
    },
  };
}

export async function writeHeartbeat(
  repo: GatewayInstanceRepository,
  input: HeartbeatWrite,
  now = new Date(),
): Promise<void> {
  await repo.upsert(heartbeatRow(input, now));
  await repo.deleteLastSeenBefore(new Date(now.getTime() - HEARTBEAT_RETENTION_MS));
}

export function coerceDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(String(value ?? ""));
}

export function statusFromStored(value: unknown, instanceId: string): HeartbeatStatus {
  const parsed = parseHeartbeatBody(
    value && typeof value === "object" ? { ...(value as Record<string, unknown>), instanceId } : { instanceId },
  );
  if (!parsed) {
    return {
      instanceId,
      startedAt: "",
      domains: CORE_DOMAINS.map((domain) => emptyDomain(domain)),
    };
  }
  return {
    instanceId: parsed.instanceId,
    startedAt: parsed.startedAt,
    domains: parsed.domains,
  };
}
