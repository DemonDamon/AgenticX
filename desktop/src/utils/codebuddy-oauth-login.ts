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
};

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

export async function waitForCodebuddyOAuth(args: {
  apiBase: string;
  apiToken: string;
  jobId: string;
  onUpdate?: (snap: CodebuddyOAuthSnapshot) => void;
  openAuthorizeUrl?: (url: string) => void;
  pollIntervalMs?: number;
  maxMs?: number;
}): Promise<CodebuddyOAuthSnapshot> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const interval = args.pollIntervalMs ?? 800;
  const maxMs = args.maxMs ?? 600_000;
  const started = Date.now();
  let openedUrl = false;
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
        openedUrl = true;
        args.openAuthorizeUrl?.(url);
      }
      if (codebuddyOAuthTerminalStatus(snap.status)) {
        return snap;
      }
    }
    await sleep(interval);
  }
  return { job_id: args.jobId, status: "failed", error: "等待腾讯授权超时" };
}
