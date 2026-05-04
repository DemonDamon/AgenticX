import { createHash } from "node:crypto";
import type { AuditDigest, AuditPolicyHit } from "@agenticx/core-api";
import { gatewayAuditEvents } from "@agenticx/db-schema";
import { getIamDb } from "@agenticx/iam-core";
import { and, asc, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import { ulid } from "ulid";
import type { AuditActor, AuditEvent, AuditQueryInput, AuditQueryResult, AuditStore } from "../types";

const EXPORT_ROW_HARD_CAP = 100_000;

function computeChecksum(event: AuditEvent): string {
  const clone = { ...event, checksum: "" };
  const hash = createHash("blake2b512");
  hash.update(`${event.prev_checksum}|${JSON.stringify(clone)}`);
  return hash.digest("hex").slice(0, 64);
}

function visibilityPredicates(actor: AuditActor) {
  const scopes = new Set(actor.scopes);
  if (scopes.has("*") || scopes.has("audit:manage") || scopes.has("audit:read:all")) {
    return undefined;
  }
  if (scopes.has("audit:read:dept") && actor.deptId) {
    return eq(gatewayAuditEvents.departmentId, actor.deptId);
  }
  return eq(gatewayAuditEvents.userId, actor.userId);
}

function safePolicyId(raw: string): string | null {
  const id = raw.trim();
  if (!id || id.length > 128) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) return null;
  return id;
}

function rowToAuditEvent(row: typeof gatewayAuditEvents.$inferSelect): AuditEvent {
  const policiesRaw = row.policiesHit as AuditPolicyHit[] | null | undefined;
  const digestRaw = row.digest as AuditDigest | null | undefined;
  return {
    id: row.id,
    tenant_id: row.tenantId,
    event_time: row.eventTime.toISOString(),
    event_type: row.eventType as AuditEvent["event_type"],
    user_id: row.userId ?? null,
    user_email: row.userEmail ?? undefined,
    department_id: row.departmentId ?? undefined,
    session_id: row.sessionId ?? undefined,
    client_type: row.clientType as AuditEvent["client_type"],
    client_ip: row.clientIp ?? undefined,
    provider: row.provider ?? undefined,
    model: row.model ?? undefined,
    route: row.route as AuditEvent["route"],
    input_tokens: row.inputTokens ?? undefined,
    output_tokens: row.outputTokens ?? undefined,
    total_tokens: row.totalTokens ?? undefined,
    cost_usd: undefined,
    latency_ms: row.latencyMs ?? undefined,
    digest: digestRaw ?? undefined,
    policies_hit: Array.isArray(policiesRaw) ? policiesRaw : undefined,
    prev_checksum: row.prevChecksum,
    checksum: row.checksum,
    signature: row.signature ?? undefined,
  };
}

function checkChainSlice(items: AuditEvent[]): { valid: boolean; at?: string; reason?: string } {
  let prev = "GENESIS";
  let index = 0;
  for (const current of items) {
    if (current.client_type === "admin-console") {
      continue;
    }
    if (index > 0 && current.prev_checksum === "GENESIS") {
      return { valid: false, at: current.id, reason: "unexpected_genesis_pointer" };
    }
    if (current.prev_checksum !== prev) {
      return { valid: false, at: current.id, reason: "prev_checksum_mismatch" };
    }
    if (computeChecksum(current) !== current.checksum) {
      return { valid: false, at: current.id, reason: "checksum_mismatch" };
    }
    prev = current.checksum;
    index += 1;
  }
  return { valid: true };
}

export class PgAuditStore implements AuditStore {
  public async query(actor: AuditActor, input: AuditQueryInput): Promise<AuditQueryResult> {
    const db = getIamDb();
    const conditions = [eq(gatewayAuditEvents.tenantId, input.tenant_id)];

    const vis = visibilityPredicates(actor);
    if (vis) {
      conditions.push(vis);
    }

    if (input.user_id) {
      conditions.push(eq(gatewayAuditEvents.userId, input.user_id));
    }
    if (input.department_id) {
      conditions.push(eq(gatewayAuditEvents.departmentId, input.department_id));
    }
    if (input.provider) {
      conditions.push(eq(gatewayAuditEvents.provider, input.provider));
    }
    if (input.model) {
      conditions.push(eq(gatewayAuditEvents.model, input.model));
    }
    if (input.policy_hit) {
      const pid = safePolicyId(input.policy_hit);
      if (pid) {
        const needle = JSON.stringify([{ policy_id: pid }]);
        conditions.push(sql`${gatewayAuditEvents.policiesHit}::jsonb @> ${needle}::jsonb`);
      }
    }
    if (input.start) {
      const t = new Date(input.start);
      if (!Number.isNaN(t.getTime())) {
        conditions.push(gte(gatewayAuditEvents.eventTime, t));
      }
    }
    if (input.end) {
      const t = new Date(input.end);
      if (!Number.isNaN(t.getTime())) {
        conditions.push(lte(gatewayAuditEvents.eventTime, t));
      }
    }

    const whereClause = and(...conditions);
    const offset = Math.max(input.offset ?? 0, 0);
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 1000);

    const [countRow] = await db
      .select({ n: count() })
      .from(gatewayAuditEvents)
      .where(whereClause);

    const rows = await db
      .select()
      .from(gatewayAuditEvents)
      .where(whereClause)
      .orderBy(desc(gatewayAuditEvents.eventTime), desc(gatewayAuditEvents.id))
      .limit(limit)
      .offset(offset);

    const items = rows.map(rowToAuditEvent);
    const ascItems = [...items].sort((a, b) => {
      const ta = Date.parse(a.event_time) - Date.parse(b.event_time);
      if (ta !== 0) return ta;
      return a.id.localeCompare(b.id);
    });
    const chain = checkChainSlice(ascItems);

    return {
      total: Number(countRow?.n ?? 0),
      items,
      chain_valid: chain.valid,
      chain_error_at: chain.at,
      chain_error_reason: chain.reason,
    };
  }

  public async exportCsv(actor: AuditActor, input: AuditQueryInput): Promise<string> {
    const db = getIamDb();
    const conditions = [eq(gatewayAuditEvents.tenantId, input.tenant_id)];

    const vis = visibilityPredicates(actor);
    if (vis) {
      conditions.push(vis);
    }

    if (input.user_id) conditions.push(eq(gatewayAuditEvents.userId, input.user_id));
    if (input.department_id) conditions.push(eq(gatewayAuditEvents.departmentId, input.department_id));
    if (input.provider) conditions.push(eq(gatewayAuditEvents.provider, input.provider));
    if (input.model) conditions.push(eq(gatewayAuditEvents.model, input.model));
    if (input.policy_hit) {
      const pid = safePolicyId(input.policy_hit);
      if (pid) {
        const needle = JSON.stringify([{ policy_id: pid }]);
        conditions.push(sql`${gatewayAuditEvents.policiesHit}::jsonb @> ${needle}::jsonb`);
      }
    }
    if (input.start) {
      const t = new Date(input.start);
      if (!Number.isNaN(t.getTime())) conditions.push(gte(gatewayAuditEvents.eventTime, t));
    }
    if (input.end) {
      const t = new Date(input.end);
      if (!Number.isNaN(t.getTime())) conditions.push(lte(gatewayAuditEvents.eventTime, t));
    }

    const whereClause = and(...conditions);

    const [countRow] = await db
      .select({ n: count() })
      .from(gatewayAuditEvents)
      .where(whereClause);
    const total = Number(countRow?.n ?? 0);
    if (total > EXPORT_ROW_HARD_CAP) {
      throw new Error(
        `export exceeds hard cap (${EXPORT_ROW_HARD_CAP} rows); narrow filters or add a time range (total matching: ${total})`
      );
    }

    const header = [
      "id",
      "tenant_id",
      "event_time",
      "event_type",
      "user_id",
      "department_id",
      "provider",
      "model",
      "route",
      "total_tokens",
      "latency_ms",
      "checksum",
    ];

    const lines: string[] = [header.join(",")];
    const batch = 2000;
    for (let off = 0; off < total; off += batch) {
      const rows = await db
        .select()
        .from(gatewayAuditEvents)
        .where(whereClause)
        .orderBy(desc(gatewayAuditEvents.eventTime), desc(gatewayAuditEvents.id))
        .limit(batch)
        .offset(off);

      for (const row of rows) {
        const ev = rowToAuditEvent(row);
        const rowCsv = [
          ev.id,
          ev.tenant_id,
          ev.event_time,
          ev.event_type,
          ev.user_id ?? "",
          ev.department_id ?? "",
          ev.provider ?? "",
          ev.model ?? "",
          ev.route,
          String(ev.total_tokens ?? 0),
          String(ev.latency_ms ?? 0),
          ev.checksum,
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(",");
        lines.push(rowCsv);
      }
    }

    return lines.join("\n");
  }
}

export type ChainVerifyResult = {
  valid: boolean;
  at?: string;
  reason?: string;
  scanned: number;
};

/** Full-table scan (batched) for one tenant; skips admin-console injected rows in chain math. */
export async function verifyGatewayAuditChain(
  actor: AuditActor,
  tenantId: string
): Promise<ChainVerifyResult> {
  const scopes = new Set(actor.scopes);
  const canVerify =
    scopes.has("*") || scopes.has("audit:manage") || scopes.has("audit:read:all");
  if (!canVerify) {
    return { valid: false, reason: "forbidden", scanned: 0 };
  }
  if (actor.tenantId !== tenantId) {
    return { valid: false, reason: "tenant_mismatch", scanned: 0 };
  }

  const db = getIamDb();
  const batchSize = 5000;
  let offset = 0;
  let prev = "GENESIS";
  let index = 0;
  let scanned = 0;

  while (true) {
    const rows = await db
      .select()
      .from(gatewayAuditEvents)
      .where(eq(gatewayAuditEvents.tenantId, tenantId))
      .orderBy(asc(gatewayAuditEvents.eventTime), asc(gatewayAuditEvents.id))
      .limit(batchSize)
      .offset(offset);

    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      const current = rowToAuditEvent(row);
      if (current.client_type === "admin-console") {
        continue;
      }
      if (index > 0 && current.prev_checksum === "GENESIS") {
        return { valid: false, at: current.id, reason: "unexpected_genesis_pointer", scanned };
      }
      if (current.prev_checksum !== prev) {
        return { valid: false, at: current.id, reason: "prev_checksum_mismatch", scanned };
      }
      if (computeChecksum(current) !== current.checksum) {
        return { valid: false, at: current.id, reason: "checksum_mismatch", scanned };
      }
      prev = current.checksum;
      index += 1;
    }

    offset += batchSize;
  }

  return { valid: true, scanned };
}

export async function insertGatewayAuditExportEvent(
  actor: AuditActor,
  detail: Record<string, unknown>
): Promise<void> {
  const db = getIamDb();
  const now = new Date();
  await db.insert(gatewayAuditEvents).values({
    id: ulid(),
    tenantId: actor.tenantId,
    eventTime: now,
    eventType: "audit_export",
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
    digest: {
      ...detail,
      exported_by: actor.userId,
    },
    policiesHit: null,
    toolsCalled: null,
    prevChecksum: "admin-export",
    checksum: "admin-export",
    signature: null,
    createdAt: now,
    updatedAt: now,
  });
}
