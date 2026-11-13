import { NextResponse } from "next/server";

import {
  createSecurityIncident,
  listSecurityIncidents,
  type SecurityIncidentSeverity,
  type SecurityIncidentSource,
} from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import { insertAuditEvent } from "@agenticx/iam-core";

export const runtime = "nodejs";

const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const SOURCES = new Set(["manual", "policy_hit", "budget_alert", "chain_check", "moderation"]);

/**
 * SP5 incident-response：安全事件立案与列表。
 * 状态机由 [id] 路由流转；trace_id 关联网关防篡改审计链。
 */
export async function GET(request: Request) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status") ?? undefined;
  const status =
    statusParam && ["open", "handling", "resolved"].includes(statusParam)
      ? (statusParam as "open" | "handling" | "resolved")
      : undefined;
  const incidents = await listSecurityIncidents(auth.session.tenantId, { status });
  return NextResponse.json({ code: "00000", message: "ok", data: incidents });
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 256) {
    return NextResponse.json({ code: "40001", message: "title required (<=256)" }, { status: 400 });
  }
  const severity =
    typeof body.severity === "string" && SEVERITIES.has(body.severity)
      ? (body.severity as SecurityIncidentSeverity)
      : "high";
  const source =
    typeof body.source === "string" && SOURCES.has(body.source)
      ? (body.source as SecurityIncidentSource)
      : "manual";
  const optString = (key: string): string | null => {
    const value = body[key];
    if (typeof value !== "string" || !value.trim()) return null;
    return value.trim().slice(0, 160);
  };
  const summary = typeof body.summary === "string" ? body.summary.slice(0, 4000) : null;

  // 先审计后立案：处置链起点可追溯。
  const incident = await createSecurityIncident({
    tenantId: auth.session.tenantId,
    title,
    severity,
    source,
    traceId: optString("traceId"),
    sessionId: optString("sessionId"),
    userId: optString("userId"),
    model: optString("model"),
    summary,
    createdBy: auth.session.userId,
  });
  await insertAuditEvent({
    tenantId: auth.session.tenantId,
    actorUserId: auth.session.userId,
    eventType: "incident_created",
    targetKind: "security_incident",
    targetId: incident.id,
    detail: { title, severity, source, trace_id: incident.traceId },
  });
  return NextResponse.json({ code: "00000", message: "ok", data: incident });
}
