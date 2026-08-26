import { normalizeRunMode, type RunMode } from "../constants/confirm-strategy-options";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export type NormalizedConfirmRisk = "low" | "protected";
export type ConfirmPolicy = "ask-every-time" | "use-allowlist" | "run-everything";

/** 与后端 NEVER_AUTO_APPROVED_CATEGORIES 保持一致（agenticx/runtime/command_safety.py）。 */
export const NEVER_REUSABLE_CATEGORIES: ReadonlySet<string> = new Set([
  "destructive_filesystem",
  "external_publish",
  "host_full_access",
  "system_disruption",
]);

export function hasNeverReusableCategory(
  context?: Record<string, unknown>,
): boolean {
  const raw = context?.risk_categories;
  if (!Array.isArray(raw)) return false;
  return raw.some((item) => {
    if (typeof item === "string") return NEVER_REUSABLE_CATEGORIES.has(item);
    if (item && typeof item === "object" && "code" in item) {
      return NEVER_REUSABLE_CATEGORIES.has(String((item as { code?: unknown }).code ?? ""));
    }
    return false;
  });
}

/**
 * Mirror the backend's fail-closed confirmation policy. Only an explicit
 * `risk: "low"` may be auto-approved; missing and future values stay protected.
 */
export function normalizeConfirmRisk(
  context?: Record<string, unknown>,
): NormalizedConfirmRisk {
  return text(context?.risk).toLowerCase() === "low" ? "low" : "protected";
}

export function isProtectedConfirmContext(
  context?: Record<string, unknown>,
): boolean {
  return normalizeConfirmRisk(context) === "protected";
}

/**
 * 后端在受保护请求的 context 里带 `protected_reason`。这里优先用它，取不到才回退到
 * 本地镜像的一张表——理由的唯一出处在后端，risk 将来加一档不用记得同步改两处文案。
 */
const LOCAL_PROTECTED_REASONS: Record<string, string> = {
  high: "这条操作被标记为高风险",
  destructive: "这条操作会删除或覆盖已有内容",
  computer_use: "这条操作会读取或控制本机桌面",
  non_whitelisted: "这条命令不在默认可直接执行的白名单里",
  policy: "这条操作会改动技能或长期记忆等配置",
};
const UNKNOWN_PROTECTED_REASON = "系统无法判定这步的风险，按受保护处理";

export function protectedConfirmReason(
  context?: Record<string, unknown>,
): string {
  if (!isProtectedConfirmContext(context)) return "";
  const fromBackend = text(context?.protected_reason);
  if (fromBackend) return fromBackend;
  return LOCAL_PROTECTED_REASONS[text(context?.risk).toLowerCase()] ?? UNKNOWN_PROTECTED_REASON;
}

export function shouldAutoApproveConfirm(
  strategy: RunMode | string,
  scopeAlreadyAllowed: boolean,
  context?: Record<string, unknown>,
): boolean {
  if (isProtectedConfirmContext(context)) return false;
  const mode = normalizeRunMode(strategy);
  return mode === "auto" || scopeAlreadyAllowed;
}

export function defaultConfirmPolicyForStrategy(
  strategy: RunMode | string,
): ConfirmPolicy {
  const mode = normalizeRunMode(strategy);
  if (mode === "auto") return "run-everything";
  if (mode === "allowlist") return "use-allowlist";
  return "ask-every-time";
}

export function normalizeConfirmWorkspace(value: unknown): string {
  return text(value).replace(/\\/gu, "/").replace(/\/+$/u, "");
}

export function workspaceFromConfirmContext(
  context?: Record<string, unknown>,
  fallback = "",
): string {
  const roots = context?.workspace_roots;
  if (Array.isArray(roots) && roots.length > 0) {
    return roots.map(normalizeConfirmWorkspace).filter(Boolean).sort().join("|");
  }
  return normalizeConfirmWorkspace(context?.workspace_root ?? context?.cwd ?? fallback);
}

/** 审批记录的 key：task run + 工作区 + 既有 scope。跨 run / 跨工作区不复用。 */
export function buildConfirmApprovalKey(
  runId: string,
  workspace: string,
  scope: string,
): string {
  return JSON.stringify([text(runId), normalizeConfirmWorkspace(workspace), scope]);
}

export function parentPathForConfirmScope(pathValue: unknown): string {
  const path = text(pathValue).replace(/[\\/]+$/, "");
  if (!path) return "";
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (separator < 0) return path;
  if (separator === 0) return path.slice(0, 1);
  if (separator === 2 && /^[A-Za-z]:[\\/]/u.test(path)) return path.slice(0, 3);
  return path.slice(0, separator);
}

export function buildConfirmScope(
  question: string,
  context?: Record<string, unknown>,
): string {
  const tool = text(context?.tool);
  if (tool === "bash_exec") {
    const command = text(context?.command);
    const commandName = command.split(/\s+/u)[0] || "unknown";
    return `bash_exec:${commandName}`;
  }
  if (tool === "file_write" || tool === "file_edit") {
    const path = text(context?.path);
    const folder = parentPathForConfirmScope(path);
    return `${tool}:${folder || "/"}`;
  }
  if (tool) return `tool:${tool}`;
  return `question:${question}`;
}
