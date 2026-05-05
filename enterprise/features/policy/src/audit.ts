import { gatewayAuditEvents } from "@agenticx/db-schema";
import { getIamDb } from "@agenticx/iam-core";
import { ulid } from "ulid";

export type PolicyAuditActor = {
  tenantId: string;
  userId: string;
  deptId?: string | null;
};

export async function insertPolicyAuditEvent(
  actor: PolicyAuditActor,
  eventType: "policy_publish" | "policy_rule_change",
  detail: Record<string, unknown>
): Promise<void> {
  const db = getIamDb();
  const now = new Date();
  await db.insert(gatewayAuditEvents).values({
    id: ulid(),
    tenantId: actor.tenantId,
    eventTime: now,
    eventType,
    userId: actor.userId,
    departmentId: actor.deptId ?? null,
    sessionId: null,
    clientType: "admin-console",
    clientIp: null,
    provider: null,
    model: null,
    route: "local",
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    latencyMs: null,
    digest: detail,
    policiesHit: null,
    toolsCalled: null,
    prevChecksum: "admin-policy",
    checksum: "admin-policy",
    signature: null,
    createdAt: now,
    updatedAt: now,
  });
}
