/**
 * MCP-style CodeBuddy Tencent OAuth: studio runs `codebuddy login` subprocess,
 * Desktop opens authorize URL in WorkPanel browser and polls until success/failure.
 */

export type CodebuddyOAuthJobStatus = "starting" | "authorizing" | "success" | "failed";

export type CodebuddyOAuthSnapshot = {
  job_id?: string;
  status?: CodebuddyOAuthJobStatus;
  authorize_url?: string | null;
  error?: string | null;
  auth_verified?: boolean | null;
};

export type OpenAuthorizeUrlResult = { ok: true } | { ok: false; error?: string };

export async function startCodebuddyOAuthLogin(args: {
  apiBase: string;
  apiToken: string;
  cwd: string;
}): Promise<{ ok: boolean; snapshot?: CodebuddyOAuthSnapshot; error?: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (args.apiToken) headers["x-agx-desktop-token"] = args.apiToken;
  try {
    const res = await fetch(`${args.apiBase}/api/codebuddy/oauth/start`, {
      method: "POST",
      headers,
      body: JSON.stringify({ cwd: args.cwd || "~" }),
    });
    const data = (await res.json()) as CodebuddyOAuthSnapshot & { ok?: boolean; error?: string };
    if (!data?.job_id) {
      return { ok: false, error: data?.error || "无法启动 CodeBuddy 登录" };
    }
    return { ok: Boolean(data.ok ?? true), snapshot: data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function pollCodebuddyOAuthJob(args: {
  apiBase: string;
  apiToken: string;
  jobId: string;
}): Promise<{ ok: boolean; snapshot?: CodebuddyOAuthSnapshot; error?: string }> {
  const headers: Record<string, string> = {};
  if (args.apiToken) headers["x-agx-desktop-token"] = args.apiToken;
  const q = new URLSearchParams({ job_id: args.jobId });
  try {
    const res = await fetch(`${args.apiBase}/api/codebuddy/oauth/status?${q}`, { headers });
    const data = (await res.json()) as CodebuddyOAuthSnapshot & { ok?: boolean; error?: string };
    if (!data?.ok) return { ok: false, error: data?.error || "poll failed" };
    return { ok: true, snapshot: data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function codebuddyOAuthTerminalStatus(status: CodebuddyOAuthJobStatus | undefined): boolean {
  return status === "success" || status === "failed";
}

function tryOpenAuthorizeUrl(
  opener: ((url: string) => void | boolean | OpenAuthorizeUrlResult) | undefined,
  url: string,
): OpenAuthorizeUrlResult {
  if (!opener) {
    return { ok: false, error: "missing_open_handler" };
  }
  try {
    const out = opener(url);
    if (out === false) return { ok: false, error: "browser_open_rejected" };
    if (out === true || out === undefined) return { ok: true };
    if (typeof out === "object" && out !== null && "ok" in out) {
      return out.ok ? { ok: true } : { ok: false, error: out.error || "browser_open_failed" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function waitForCodebuddyOAuth(args: {
  apiBase: string;
  apiToken: string;
  jobId: string;
  onUpdate?: (snap: CodebuddyOAuthSnapshot) => void;
  /** Called only after authorize URL was actually opened (WorkPanel or external). */
  onAuthorizing?: () => void;
  openAuthorizeUrl?: (url: string) => void | boolean | OpenAuthorizeUrlResult;
  pollIntervalMs?: number;
  maxMs?: number;
}): Promise<CodebuddyOAuthSnapshot> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const interval = args.pollIntervalMs ?? 800;
  const maxMs = args.maxMs ?? 600_000;
  const started = Date.now();
  let openedUrl = false;
  let browserOpenFailed: string | undefined;
  while (Date.now() - started < maxMs) {
    const polled = await pollCodebuddyOAuthJob({
      apiBase: args.apiBase,
      apiToken: args.apiToken,
      jobId: args.jobId,
    });
    const snap = polled.snapshot;
    if (snap) {
      args.onUpdate?.(snap);
      const url = String(snap.authorize_url ?? "").trim();
      if (url && !openedUrl) {
        const opened = tryOpenAuthorizeUrl(args.openAuthorizeUrl, url);
        if (opened.ok) {
          openedUrl = true;
          args.onAuthorizing?.();
        } else {
          browserOpenFailed = opened.error || "browser_open_failed";
        }
      }
      if (codebuddyOAuthTerminalStatus(snap.status)) {
        if (snap.status === "success") {
          if (!openedUrl) {
            return {
              ...snap,
              status: "failed",
              error:
                browserOpenFailed
                || snap.error
                || "未打开腾讯授权页面，请重试",
            };
          }
          if (snap.auth_verified === false) {
            return {
              ...snap,
              status: "failed",
              error: snap.error || "腾讯登录未完成或凭据校验失败",
            };
          }
        }
        return snap;
      }
    }
    await sleep(interval);
  }
  return { job_id: args.jobId, status: "failed", error: "等待腾讯授权超时" };
}

/** Stop live CodeBuddy harness PTYs so the next chat turn reloads OAuth credentials. */
export async function refreshCodebuddyHarnessAfterOAuth(args: {
  apiBase: string;
  apiToken: string;
  sessionId: string;
}): Promise<{ ok: boolean; stopped_surface_ids?: string[]; refreshed_binding?: boolean; error?: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (args.apiToken) headers["x-agx-desktop-token"] = args.apiToken;
  const sid = String(args.sessionId || "").trim();
  if (!sid) {
    return { ok: false, error: "session_id required" };
  }
  try {
    const res = await fetch(`${args.apiBase}/api/codebuddy/oauth/refresh-harness`, {
      method: "POST",
      headers,
      body: JSON.stringify({ session_id: sid }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      stopped_surface_ids?: string[];
      refreshed_binding?: boolean;
      error?: string;
    };
    if (!data?.ok) {
      return { ok: false, error: data?.error || "刷新 CodeBuddy 会话失败" };
    }
    return {
      ok: true,
      stopped_surface_ids: data.stopped_surface_ids,
      refreshed_binding: data.refreshed_binding,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
