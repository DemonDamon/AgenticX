import { NextResponse } from "next/server";
import { getAdminUser, listAgents, type MaSessionDetail, type MaSessionSummary } from "@agenticx/iam-core";

export const SESSION_STATUSES = ["idle", "running", "rescheduling", "terminated", "archived"] as const;
export const SESSION_SOURCES = ["portal", "desktop", "api", "schedule", "channel", "eval"] as const;
export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const VALIDATION_MESSAGES = new Set([
  "智能体参数不合法",
  "状态参数不合法",
  "来源参数不合法",
  "时间范围参数不合法",
  "分页参数不合法",
]);

const MISSING_TABLE_RE = /ma_sessions|ma_session_events|relation .* does not exist|doesn't exist/i;

export class MaConsoleRequestError extends Error {
  override name = "MaConsoleRequestError";

  constructor(message: string) {
    super(message);
  }
}

/** 400 {code:"40000", message} | 503 {code:"50301", message:"托管会话数据表不存在，请先执行数据库迁移"} | 500 {code:"50001", message:"internal error"} */
export function maSessionErrorResponse(error: unknown): NextResponse {
  if (error instanceof MaConsoleRequestError || (error instanceof Error && VALIDATION_MESSAGES.has(error.message))) {
    return NextResponse.json({ code: "40000", message: error.message }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : String(error);
  if (MISSING_TABLE_RE.test(message)) {
    return NextResponse.json(
      { code: "50301", message: "托管会话数据表不存在，请先执行数据库迁移" },
      { status: 503 },
    );
  }
  console.error(error);
  return NextResponse.json({ code: "50001", message: "internal error" }, { status: 500 });
}

export function sessionNotFoundResponse(): NextResponse {
  return NextResponse.json({ code: "40400", message: "会话不存在" }, { status: 404 });
}

export type UserBrief = { id: string; email: string; displayName: string };

/** 去重后并发 getAdminUser；单个失败记为缺失，不抛错。 */
export async function loadUserBriefs(tenantId: string, userIds: readonly string[]): Promise<Map<string, UserBrief>> {
  const unique = [...new Set(userIds.filter((id) => id.length > 0))];
  const loaded = await Promise.all(
    unique.map(async (id) => {
      try {
        const user = await getAdminUser(tenantId, id);
        if (!user) return null;
        const brief: UserBrief = {
          id: user.id || id,
          email: user.email ?? "",
          displayName: user.displayName ?? "",
        };
        return [id, brief] as const;
      } catch {
        return null;
      }
    }),
  );
  const briefs = new Map<string, UserBrief>();
  for (const entry of loaded) {
    if (entry) briefs.set(entry[0], entry[1]);
  }
  return briefs;
}

/** listAgents(tenantId) → Map<id, {displayName, slug}>；失败返回空 Map。 */
export async function loadAgentNames(
  tenantId: string,
): Promise<Map<string, { displayName: string; slug: string }>> {
  try {
    const agents = await listAgents(tenantId);
    const names = new Map<string, { displayName: string; slug: string }>();
    for (const agent of agents) {
      names.set(agent.id, { displayName: agent.displayName, slug: agent.slug });
    }
    return names;
  } catch {
    return new Map();
  }
}

export type PublicSession = {
  id: string;
  title: string | null;
  agentId: string;
  agentName: string | null;
  agentVersion: number;
  environmentId: string | null;
  source: string;
  status: string;
  stopReason: Record<string, unknown> | null;
  user: UserBrief | null;
  usage: MaSessionSummary["usage"];
  lastSeq: number;
  createdAt: string;
  updatedAt: string;
};

export function toPublicSession(
  item: MaSessionSummary,
  agents: Map<string, { displayName: string; slug: string }>,
  users: Map<string, UserBrief>,
): PublicSession {
  const agent = agents.get(item.agentId);
  const userId = item.createdByUserId;
  const user = userId ? (users.get(userId) ?? { id: userId, email: "", displayName: "" }) : null;
  return {
    id: item.id,
    title: item.title,
    agentId: item.agentId,
    agentName: agent ? agent.displayName : null,
    agentVersion: item.agentVersion,
    environmentId: item.environmentId,
    source: item.source,
    status: item.status,
    stopReason: item.stopReason,
    user,
    usage: item.usage,
    lastSeq: item.lastSeq,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function toPublicDetail(
  item: MaSessionDetail,
  agents: Map<string, { displayName: string; slug: string }>,
  users: Map<string, UserBrief>,
) {
  return {
    ...toPublicSession(item, agents, users),
    vaultIds: item.vaultIds,
    resources: item.resources,
  };
}
