export const REPLICA_OFFLINE_AFTER_MS = 2 * 60 * 1000;

export type ReplicaStatus = "applied" | "pending" | "offline";

export type ReplicaDomainView = {
  domain: string;
  version?: string;
  lastError?: string;
};

export function policyPublishVersion(tenants: Array<{ tenantId: string; publishId: string }>): string {
  const rows = [...tenants].sort((a, b) => (a.tenantId < b.tenantId ? -1 : a.tenantId > b.tenantId ? 1 : 0));
  return rows.map((row) => row.publishId).join(",");
}

export function classifyReplica(input: {
  lastSeenAt: Date;
  now: Date;
  domains: ReplicaDomainView[];
  publishedPolicyVersion: string;
}): ReplicaStatus {
  const seen = input.lastSeenAt.getTime();
  if (Number.isNaN(seen) || input.now.getTime() - seen >= REPLICA_OFFLINE_AFTER_MS) {
    return "offline";
  }
  const policy = input.domains.find((domain) => domain.domain === "policy");
  const version = (policy?.version ?? "").trim();
  const expected = input.publishedPolicyVersion.trim();
  const mismatch = version !== expected;
  const hasError = input.domains.some((domain) => (domain.lastError ?? "").trim() !== "");
  if (mismatch || hasError) return "pending";
  return "applied";
}
