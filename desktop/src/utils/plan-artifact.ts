import { load as parseYaml } from "js-yaml";

export type PlanTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type PlanArtifactStatus = "ready" | "building" | "completed" | "cancelled";

export type PlanTodo = {
  id: string;
  content: string;
  status: PlanTodoStatus;
};

export type PlanArtifactPayload = {
  type: "plan_artifact";
  action: "created" | "updated";
  plan_id: string;
  path: string;
  name: string;
  overview: string;
  status: PlanArtifactStatus;
  session_id?: string;
  todos: PlanTodo[];
  outcome?: string;
};

export type PlanArtifactMessage = {
  role?: string;
  toolName?: string;
  content?: unknown;
};

export const NEAR_PLAN_BUILD_REQUEST = "near:plan-build-request";

const TODO_STATUSES = new Set<PlanTodoStatus>([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);
const PLAN_STATUSES = new Set<PlanArtifactStatus>([
  "ready",
  "building",
  "completed",
  "cancelled",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTodos(value: unknown): PlanTodo[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const todos: PlanTodo[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const id = String(item.id ?? "").trim();
    const content = String(item.content ?? "").trim();
    const status = String(item.status ?? "").trim() as PlanTodoStatus;
    if (!id || !content || !TODO_STATUSES.has(status)) return null;
    todos.push({ id, content, status });
  }
  return todos;
}

function parsePlanRecord(
  value: unknown,
  pathOverride?: string,
  actionOverride?: "created" | "updated",
): PlanArtifactPayload | null {
  if (!isRecord(value)) return null;
  const type = String(value.type ?? "plan_artifact");
  if (type !== "plan_artifact") return null;
  const planId = String(value.plan_id ?? "").trim();
  const path = String(pathOverride ?? value.path ?? "").trim();
  const name = String(value.name ?? "").trim();
  const overview = String(value.overview ?? "").trim();
  const status = String(value.status ?? "").trim() as PlanArtifactStatus;
  const todos = parseTodos(value.todos);
  const action = actionOverride ?? String(value.action ?? "updated");
  if (
    !planId ||
    !path ||
    !name ||
    !overview ||
    !PLAN_STATUSES.has(status) ||
    !todos ||
    (action !== "created" && action !== "updated")
  ) {
    return null;
  }
  const sessionId = String(value.session_id ?? "").trim();
  const outcome = String(value.outcome ?? "").trim();
  return {
    type: "plan_artifact",
    action,
    plan_id: planId,
    path,
    name,
    overview,
    status,
    ...(sessionId ? { session_id: sessionId } : {}),
    todos,
    ...(outcome ? { outcome } : {}),
  };
}

export function parsePlanArtifactToolResult(raw: unknown): PlanArtifactPayload | null {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsePlanRecord(value);
  } catch {
    return null;
  }
}

export function parsePlanMarkdown(markdown: string, path: string): PlanArtifactPayload | null {
  const text = String(markdown ?? "");
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return null;
  try {
    const metadata = parseYaml(text.slice(4, end));
    return parsePlanRecord(metadata, path, "updated");
  } catch {
    return null;
  }
}

export function isNaturalLanguagePlanBuildRequest(rawText: string): boolean {
  const normalized = String(rawText ?? "")
    .trim()
    .toLowerCase()
    .replace(/[。！!]+$/g, "")
    .replace(/\s+/g, " ");
  if (!normalized || normalized.length > 80) return false;
  if (/[?？]/.test(normalized) || /(?:吗|么|呢)$/.test(normalized)) return false;
  if (/(?:不要|别|先不|暂不|不必|稍等|等等|don't|do not|not yet|wait)/i.test(normalized)) {
    return false;
  }
  const command = normalized.replace(/^(?:好的?|可以|行|ok(?:ay)?)[,，\s]*/i, "");
  return [
    /^(?:开始|继续|执行|实施|开工)(?:\s*(?:build|构建|执行|实施|开发|干活))?(?:\s*(?:这个|当前|该)?计划)?(?:吧|了)?$/i,
    /^(?:按|照|按照)(?:这个|当前|该)?计划(?:开始|继续)?(?:执行|实施|开发|构建|build)(?:吧|了)?$/i,
    /^(?:start|continue|resume|run|execute)(?:\s+the)?\s+(?:build|implementation|plan)$/i,
    /^build(?:\s+it)?$/i,
  ].some((pattern) => pattern.test(command));
}

export function findLatestPlanArtifact(
  messages: readonly PlanArtifactMessage[],
  sessionId?: string,
): PlanArtifactPayload | null {
  const expectedSessionId = String(sessionId ?? "").trim();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "tool") continue;
    const toolName = String(message.toolName ?? "").trim();
    if (toolName !== "plan_create" && toolName !== "plan_update") continue;
    const plan = parsePlanArtifactToolResult(message.content);
    if (!plan) continue;
    if (expectedSessionId && plan.session_id !== expectedSessionId) continue;
    return plan;
  }
  return null;
}

export function derivePlanProgress(plan: PlanArtifactPayload): {
  completed: number;
  total: number;
  percent: number;
} {
  const active = plan.todos.filter((todo) => todo.status !== "cancelled");
  const completed = active.filter((todo) => todo.status === "completed").length;
  const total = active.length;
  return {
    completed,
    total,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}
