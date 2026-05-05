import { users } from "@agenticx/db-schema";
import {
  PgPolicyStore,
  type PolicyPack,
  type PolicyPublishEvent,
  type PolicyRule,
  type PolicyRuleFilter,
  type PolicyStage,
  type PolicyTestResult,
} from "@agenticx/feature-policy";
import { getIamDb } from "@agenticx/iam-core";
import { and, eq } from "drizzle-orm";
import type { AdminSession } from "./admin-auth";

const store = new PgPolicyStore();

export type PolicyActor = {
  tenantId: string;
  userId: string;
  deptId: string | null;
};

export async function buildPolicyActor(session: AdminSession): Promise<PolicyActor> {
  const db = getIamDb();
  const [row] = await db
    .select({ deptId: users.deptId })
    .from(users)
    .where(and(eq(users.tenantId, session.tenantId), eq(users.id, session.userId)))
    .limit(1);
  return {
    tenantId: session.tenantId,
    userId: session.userId,
    deptId: row?.deptId ?? null,
  };
}

export async function listPolicyPacks(tenantId: string): Promise<PolicyPack[]> {
  return store.listPacks(tenantId);
}

export async function createPolicyPack(
  actor: PolicyActor,
  input: {
    code: string;
    name: string;
    description?: string | null;
    enabled?: boolean;
    appliesTo?: Record<string, unknown> | null;
  }
): Promise<PolicyPack> {
  const pack = await store.createPack({
    tenantId: actor.tenantId,
    code: input.code,
    name: input.name,
    description: input.description,
    enabled: input.enabled,
    appliesTo: input.appliesTo as never,
  });
  await store.recordRuleChange(actor, { action: "create_pack", packCode: pack.code });
  return pack;
}

export async function updatePolicyPack(
  actor: PolicyActor,
  code: string,
  patch: {
    name?: string;
    description?: string | null;
    enabled?: boolean;
    appliesTo?: Record<string, unknown> | null;
  }
): Promise<PolicyPack> {
  const pack = await store.updatePack(actor.tenantId, code, {
    name: patch.name,
    description: patch.description,
    enabled: patch.enabled,
    appliesTo: patch.appliesTo as never,
  });
  await store.recordRuleChange(actor, { action: "update_pack", packCode: code, patch });
  return pack;
}

export async function deletePolicyPack(actor: PolicyActor, code: string): Promise<void> {
  await store.deletePack(actor.tenantId, code);
  await store.recordRuleChange(actor, { action: "delete_pack", packCode: code });
}

export async function listPolicyRules(tenantId: string, filter?: PolicyRuleFilter): Promise<PolicyRule[]> {
  return store.listRules(tenantId, filter);
}

export async function upsertPolicyRule(
  actor: PolicyActor,
  input: {
    id?: string;
    packId: string;
    code: string;
    kind: "keyword" | "regex" | "pii";
    action: "block" | "redact" | "warn";
    severity: "low" | "medium" | "high" | "critical";
    message?: string | null;
    payload: Record<string, unknown>;
    appliesTo?: Record<string, unknown> | null;
    status?: "draft" | "active" | "disabled";
  }
): Promise<PolicyRule> {
  const rule = await store.upsertRule({
    ...input,
    tenantId: actor.tenantId,
    payload: input.payload as never,
    appliesTo: input.appliesTo as never,
    updatedBy: actor.userId,
  });
  await store.recordRuleChange(actor, {
    action: input.id ? "update_rule" : "create_rule",
    ruleId: rule.id,
    code: rule.code,
    kind: rule.kind,
  });
  return rule;
}

export async function deletePolicyRule(actor: PolicyActor, ruleId: string): Promise<void> {
  await store.deleteRule(actor.tenantId, ruleId);
  await store.recordRuleChange(actor, { action: "delete_rule", ruleId });
}

export async function setPolicyRuleStatus(
  actor: PolicyActor,
  ruleId: string,
  status: "draft" | "active" | "disabled"
): Promise<void> {
  await store.setRuleStatus(actor.tenantId, ruleId, status, actor.userId);
  await store.recordRuleChange(actor, { action: "set_rule_status", ruleId, status });
}

export async function testPolicyRules(
  tenantId: string,
  input: { ruleIds: string[]; sampleText: string; stage?: PolicyStage }
): Promise<PolicyTestResult> {
  return store.testRules(tenantId, input.ruleIds, input.sampleText, input.stage ?? "request");
}

export async function publishPolicy(actor: PolicyActor, activateDraftRuleIds?: string[]) {
  return store.publish(actor.tenantId, actor, { activateDraftRuleIds });
}

export async function listPolicyPublishes(tenantId: string): Promise<PolicyPublishEvent[]> {
  return store.listPublishes(tenantId);
}

export async function rollbackPolicyPublish(actor: PolicyActor, eventId: string) {
  return store.rollback(actor.tenantId, eventId, actor);
}

