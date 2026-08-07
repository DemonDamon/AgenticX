/**
 * User-facing copy for artifact list/preview/download request failures.
 *
 * The panel is an end-user surface, so raw transport details (`HTTP 401`,
 * `Failed to fetch`) must never reach the screen — they read as a broken app
 * instead of an expired login.
 */

export type ArtifactRequestScope = "list" | "preview" | "download";

const SCOPE_FALLBACK: Record<ArtifactRequestScope, string> = {
  list: "文件列表加载失败，请稍后重试",
  preview: "预览加载失败，请稍后重试",
  download: "文件下载失败，请稍后重试",
};

const SESSION_EXPIRED = "登录状态已失效，请重新登录后再试";
const PASSWORD_CHANGE_REQUIRED = "需要先修改登录密码才能访问文件";
const OFFLINE = "无法连接门户服务，请检查网络后重试";

/** Map a failed artifact response to actionable Chinese copy. */
export function artifactRequestErrorMessage(
  status: number,
  scope: ArtifactRequestScope,
  code?: string,
): string {
  if (status === 401) return SESSION_EXPIRED;
  if (status === 403) {
    return code === "40302" ? PASSWORD_CHANGE_REQUIRED : "没有访问该文件的权限";
  }
  if (status === 404) {
    return scope === "list" ? "该会话不存在或已被删除" : "文件不存在或已被删除";
  }
  if (status === 429) return "请求过于频繁，请稍后重试";
  if (status >= 500) return "服务暂时不可用，请稍后重试";
  return SCOPE_FALLBACK[scope];
}

/** Read the `{ error: { code } }` / `{ code }` marker without failing on empty bodies. */
export async function readArtifactErrorCode(res: {
  json: () => Promise<unknown>;
}): Promise<string | undefined> {
  try {
    const raw = await res.json();
    if (!raw || typeof raw !== "object") return undefined;
    const direct = (raw as { code?: unknown }).code;
    if (typeof direct === "string") return direct;
    const nested = (raw as { error?: { code?: unknown } }).error?.code;
    return typeof nested === "string" ? nested : undefined;
  } catch {
    return undefined;
  }
}

/** Final guard so browser transport failures and unknown throws stay readable. */
export function normalizeArtifactRequestError(err: unknown, scope: ArtifactRequestScope): string {
  const raw = err instanceof Error ? err.message.trim() : "";
  if (!raw) return SCOPE_FALLBACK[scope];
  const lower = raw.toLowerCase();
  if (
    lower === "failed to fetch" ||
    lower === "load failed" ||
    lower === "network error" ||
    lower.includes("networkerror") ||
    lower.includes("fetch failed")
  ) {
    return OFFLINE;
  }
  // Anything still shaped like a bare status line is a transport detail, not copy.
  if (/^http\s*\d{3}$/i.test(raw)) return SCOPE_FALLBACK[scope];
  return raw;
}
