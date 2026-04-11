import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  MenuItemConstructorOptions,
  nativeImage,
  powerSaveBlocker,
  shell,
  Tray
} from "electron";
import { spawn, ChildProcess, execFile } from "node:child_process";

// Before app.ready: mitigate Chromium paint corruption (smearing/ghosting) on
// some Windows + NVIDIA (or hybrid GPU) stacks.
// Policy: disable GPU by default on Windows; AGX_DISABLE_GPU=1 also forces it on other OSes.
if (process.platform === "win32" || process.env.AGX_DISABLE_GPU === "1") {
  app.commandLine.appendSwitch("disable-gpu");
  app.disableHardwareAcceleration();
}
import path from "node:path";
import net from "node:net";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import yaml from "js-yaml";

/** Node fetch honors HTTP_PROXY; localhost cc-bridge POSTs then fail (e.g. 502) and PTY input never reaches Claude. */
function ccBridgeUrlIsLoopback(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    const h = (u.hostname || "").toLowerCase();
    return h === "127.0.0.1" || h === "localhost" || h === "::1";
  } catch {
    return false;
  }
}

async function ccBridgeHttpPostJson(
  fullUrl: string,
  token: string,
  jsonBody: Record<string, unknown>,
  signal?: AbortSignal
): Promise<boolean> {
  const payload = JSON.stringify(jsonBody);
  if (!ccBridgeUrlIsLoopback(fullUrl)) {
    try {
      const resp = await fetch(fullUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: payload,
        signal,
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
  const buf = Buffer.from(payload, "utf8");
  let u: URL;
  try {
    u = new URL(fullUrl);
  } catch {
    return false;
  }
  return await new Promise((resolve) => {
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": String(buf.length),
        },
      },
      (res) => {
        res.resume();
        const c = res.statusCode || 0;
        resolve(c >= 200 && c < 300);
      }
    );
    req.on("error", () => resolve(false));
    if (signal) {
      const onAbort = () => {
        req.destroy();
        resolve(false);
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    req.write(buf);
    req.end();
  });
}

async function ccBridgeHttpGetStreamLoopback(
  fullUrl: string,
  token: string,
  signal: AbortSignal,
  onData: (chunk: Buffer) => void
): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(fullUrl);
  } catch {
    return false;
  }
  return await new Promise((resolve, reject) => {
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
      (res) => {
        const code = res.statusCode || 0;
        if (code < 200 || code >= 300) {
          res.resume();
          resolve(false);
          return;
        }
        res.on("data", (chunk: Buffer) => {
          onData(chunk);
        });
        res.on("end", () => resolve(true));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    const onAbort = () => {
      req.destroy();
      reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    req.end();
  });
}

type ProviderConfig = {
  api_key?: string;
  base_url?: string;
  model?: string;
  models?: string[];
  enabled?: boolean;
  drop_params?: boolean;
};

type RemoteServerConfig = {
  enabled?: boolean;
  url?: string;
  token?: string;
};

type ResolvedRemoteConfig = {
  url: string;
  token: string;
};

type AgxConfig = {
  version?: string;
  default_provider?: string;
  providers?: Record<string, ProviderConfig>;
  user_mode?: "pro" | "lite";
  onboarding_completed?: boolean;
  confirm_strategy?: "manual" | "semi-auto" | "auto";
  active_provider?: string;
  active_model?: string;
  remote_server?: RemoteServerConfig;
  gateway?: {
    enabled?: boolean;
    url?: string;
    device_id?: string;
    token?: string;
    studio_base_url?: string;
  };
  feishu_longconn?: {
    enabled?: boolean;
    app_id?: string;
    app_secret?: string;
  };
  notifications?: {
    email?: {
      enabled?: boolean;
      smtp_host?: string;
      smtp_port?: number;
      smtp_username?: string;
      smtp_password?: string;
      smtp_use_tls?: boolean;
      from_email?: string;
      default_to_email?: string;
    };
  };
  computer_use?: Record<string, unknown>;
  agent_harness_trinity?: {
    skill_protocol?: boolean;
    session_summary?: boolean;
    learning_enabled?: boolean;
  };
  automation?: { prevent_sleep?: boolean };
  skills?: { non_high_risk_auto_install?: boolean };
};

type EmailConfig = {
  enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_use_tls: boolean;
  from_email: string;
  default_to_email: string;
};

type TrinityConfig = {
  skill_protocol: boolean;
  session_summary: boolean;
  learning_enabled: boolean;
  skill_manage_enabled: boolean;
};

type AutomationConfig = {
  prevent_sleep: boolean;
};

type SkillInstallPolicyConfig = {
  non_high_risk_auto_install: boolean;
};

const CONFIG_DIR = path.join(os.homedir(), ".agenticx");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.yaml");
const AUTOMATION_TASKS_PATH = path.join(CONFIG_DIR, "automation_tasks.json");
/** 默认定时任务根目录：~/.agenticx/crontask/<taskId>/，与用户指定 workspace 二选一；venv/脚本均应落在任务根下 */
const AUTOMATION_CRONTASK_DIR = path.join(CONFIG_DIR, "crontask");

function defaultAutomationCrontaskPath(taskId: string): string {
  return path.join(AUTOMATION_CRONTASK_DIR, String(taskId ?? "").trim());
}
const WORKSPACE_DIR = path.join(CONFIG_DIR, "workspace");
const META_SOUL_PATH = path.join(WORKSPACE_DIR, "SOUL.md");
const AVATARS_DIR = path.join(CONFIG_DIR, "avatars");
const FEISHU_BINDING_PATH = path.join(CONFIG_DIR, "feishu_binding.json");
const FEISHU_DESKTOP_BINDING_KEY = "_desktop";
const WECHAT_BINDING_PATH = path.join(CONFIG_DIR, "wechat_binding.json");
const WECHAT_DESKTOP_BINDING_KEY = "_desktop";

function clearWechatDesktopBindingIfDeleted(sessionIds: string[]): void {
  const deletedIds = new Set(sessionIds.map((sid) => String(sid || "").trim()).filter(Boolean));
  if (deletedIds.size === 0) return;
  let data: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(WECHAT_BINDING_PATH, "utf-8");
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }
  const desktopBinding = data[WECHAT_DESKTOP_BINDING_KEY];
  if (!desktopBinding || typeof desktopBinding !== "object" || Array.isArray(desktopBinding)) {
    return;
  }
  const boundSid = String((desktopBinding as { session_id?: unknown }).session_id ?? "").trim();
  if (!boundSid || !deletedIds.has(boundSid)) return;
  delete data[WECHAT_DESKTOP_BINDING_KEY];
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(WECHAT_BINDING_PATH, JSON.stringify(data, null, 2), "utf-8");
}
const EMAIL_CONFIG_KEYS = new Set([
  "enabled",
  "smtp_host",
  "smtp_port",
  "smtp_username",
  "smtp_password",
  "smtp_use_tls",
  "from_email",
  "default_to_email",
]);
const DEFAULT_EMAIL_CONFIG: EmailConfig = {
  enabled: true,
  smtp_host: "",
  smtp_port: 587,
  smtp_username: "",
  smtp_password: "",
  smtp_use_tls: true,
  from_email: "",
  default_to_email: "bingzhenli@hotmail.com",
};
const TRINITY_CONFIG_KEYS = new Set(["skill_protocol", "session_summary", "learning_enabled", "skill_manage_enabled"]);
const DEFAULT_TRINITY_CONFIG: TrinityConfig = {
  skill_protocol: true,
  session_summary: false,
  learning_enabled: false,
  skill_manage_enabled: false,
};

const DEFAULT_AUTOMATION_CONFIG: AutomationConfig = {
  prevent_sleep: false,
};

const DEFAULT_SKILL_INSTALL_POLICY: SkillInstallPolicyConfig = {
  non_high_risk_auto_install: true,
};

let preventSleepBlockerId: number | null = null;

function loadAutomationConfigFromAgx(cfg: AgxConfig): AutomationConfig {
  const raw = cfg.automation;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_AUTOMATION_CONFIG };
  }
  const row = raw as Record<string, unknown>;
  return {
    prevent_sleep: parseBooleanLoose(row.prevent_sleep, DEFAULT_AUTOMATION_CONFIG.prevent_sleep),
  };
}

function loadSkillInstallPolicyFromAgx(cfg: AgxConfig): SkillInstallPolicyConfig {
  const raw = cfg.skills;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_SKILL_INSTALL_POLICY };
  }
  const row = raw as Record<string, unknown>;
  return {
    non_high_risk_auto_install: parseBooleanLoose(
      row.non_high_risk_auto_install,
      DEFAULT_SKILL_INSTALL_POLICY.non_high_risk_auto_install
    ),
  };
}

function applyPreventSleepFromConfig(cfg: AgxConfig): void {
  const enabled = loadAutomationConfigFromAgx(cfg).prevent_sleep;
  if (enabled) {
    if (preventSleepBlockerId === null) {
      preventSleepBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    }
  } else if (preventSleepBlockerId !== null) {
    powerSaveBlocker.stop(preventSleepBlockerId);
    preventSleepBlockerId = null;
  }
}

// ── Automation Tasks ──

type AutomationFrequency =
  | { type: "daily"; time: string; days: number[] }
  | { type: "interval"; hours: number; days: number[] }
  | { type: "once"; time: string; date: string };

interface AutomationTaskData {
  id: string;
  name: string;
  prompt: string;
  workspace?: string;
  sessionId?: string;
  frequency: AutomationFrequency;
  effectiveDateRange?: { start?: string; end?: string };
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  lastRunStatus?: "success" | "error";
  lastRunError?: string;
  fromTemplate?: string;
}

function sanitizeAutomationRunError(raw: unknown): string | undefined {
  const s = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!s) return undefined;
  return s.length > 280 ? `${s.slice(0, 277)}...` : s;
}

type AutomationTaskProgressPayload = {
  taskId: string;
  taskName: string;
  trigger: "schedule" | "manual";
  phase: "queued" | "running" | "success" | "error";
  sessionId?: string;
  message?: string;
  ts: number;
};

function loadAutomationTasks(): AutomationTaskData[] {
  try {
    if (!fs.existsSync(AUTOMATION_TASKS_PATH)) return [];
    const raw = fs.readFileSync(AUTOMATION_TASKS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAutomationTasks(tasks: AutomationTaskData[]): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(AUTOMATION_TASKS_PATH, JSON.stringify(tasks, null, 2), "utf-8");
}

/** Max wait for one automation /api/chat SSE (ms). Prevents sidebar spinner stuck if stream never closes. */
function resolveAutomationChatTimeoutMs(): number {
  const raw = String(process.env.AGX_AUTOMATION_CHAT_TIMEOUT_MS ?? "").trim();
  if (!raw) return 1_800_000; // 30 min
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 60_000 ? n : 1_800_000;
}

/** In-flight automation run (scheduled or「立即执行」) — user can abort via IPC. */
const automationRunControllers = new Map<string, AbortController>();
const automationRunUserCancelled = new Set<string>();

function resolveAutomationSessionId(task: AutomationTaskData, override?: string): string {
  const o = String(override ?? "").trim();
  if (o) return o;
  return String(task.sessionId ?? "").trim();
}

async function drainSseChatResponse(resp: Response): Promise<{ ok: boolean; error?: string }> {
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    return { ok: false, error: `HTTP ${resp.status}: ${t.slice(0, 400)}` };
  }
  const reader = resp.body?.getReader();
  if (!reader) return { ok: true };
  const dec = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      while (true) {
        const sep = buffer.indexOf("\n\n");
        if (sep === -1) break;
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of chunk.split("\n")) {
          const m = line.match(/^data:\s*(.+)$/);
          if (!m) continue;
          try {
            const obj = JSON.parse(m[1]) as { type?: string; data?: { text?: string } };
            if (obj.type === "error") {
              const msg = String(obj.data?.text ?? "Agent 流式错误");
              return { ok: false, error: msg.slice(0, 800) };
            }
            if (obj.type === "done") {
              return { ok: true };
            }
          } catch {
            /* ignore non-JSON sse lines */
          }
        }
      }
      if (buffer.length > 4_000_000) break;
    }
  } finally {
    reader.releaseLock();
  }
  return { ok: true };
}

async function invokeAutomationUserTurnWithSignal(
  base: string,
  token: string,
  sessionId: string,
  userInput: string,
  workspacePath: string | undefined,
  signal: AbortSignal,
  taskId: string,
  timeoutMs: number,
): Promise<{ ok: boolean; error?: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["x-agx-desktop-token"] = token;
  const pathTrim = String(workspacePath ?? "").trim();
  if (pathTrim) {
    try {
      const wsResp = await fetch(`${base}/api/taskspace/workspaces`, {
        method: "POST",
        headers,
        body: JSON.stringify({ session_id: sessionId, path: pathTrim }),
      });
      if (!wsResp.ok) {
        const t = await wsResp.text().catch(() => "");
        console.warn(
          `[automation] taskspace attach failed: HTTP ${wsResp.status} ${t.slice(0, 240)} (session=${sessionId})`,
        );
      }
    } catch (e) {
      console.warn("[automation] taskspace attach error:", e);
    }
  }
  try {
    const resp = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        session_id: sessionId,
        user_input: userInput,
        // interactive：不把任务提示词包进 AutoSolve 长模板写入历史；避免与飞书/Machi 会话混淆且便于删除持久化
        mode: "interactive",
      }),
      signal,
    });
    return await drainSseChatResponse(resp);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const name = e instanceof Error ? e.name : "";
    const aborted =
      name === "AbortError" || /aborted|AbortError/i.test(msg);
    if (aborted) {
      if (automationRunUserCancelled.has(taskId)) {
        return { ok: false, error: "已手动终止本次自动化执行。" };
      }
      const mins = Math.max(1, Math.round(timeoutMs / 60_000));
      return {
        ok: false,
        error: `自动化执行超时（>${mins} 分钟）。侧栏已停止转圈；可缩短提示词、换模型或设置环境变量 AGX_AUTOMATION_CHAT_TIMEOUT_MS 调大上限。`,
      };
    }
    return { ok: false, error: msg.slice(0, 800) };
  }
}

async function createAutomationTaskSession(
  base: string,
  token: string,
  task: AutomationTaskData,
): Promise<string | undefined> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["x-agx-desktop-token"] = token;
  const resp = await fetch(`${base}/api/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      avatar_id: `automation:${task.id}`,
      name: task.name,
    }),
  });
  if (!resp.ok) return undefined;
  const data = (await resp.json()) as { session_id?: unknown };
  const sid = String(data.session_id ?? "").trim();
  return sid || undefined;
}

function persistAutomationTaskSession(taskId: string, sessionId: string): void {
  const tid = String(taskId ?? "").trim();
  const sid = String(sessionId ?? "").trim();
  if (!tid || !sid) return;
  const tasks = loadAutomationTasks();
  const found = tasks.find((t) => t.id === tid);
  if (!found) return;
  found.sessionId = sid;
  saveAutomationTasks(tasks);
}

type AutomationSessionBindCheck =
  | { kind: "match" }
  | { kind: "mismatch"; avatarLabel: string }
  | { kind: "unknown" };

async function checkAutomationSessionBinding(
  base: string,
  token: string,
  taskId: string,
  sessionId: string,
): Promise<AutomationSessionBindCheck> {
  const tid = String(taskId ?? "").trim();
  if (!tid) return { kind: "unknown" };
  const expected = `automation:${tid}`;
  try {
    const headers: Record<string, string> = {};
    if (token) headers["x-agx-desktop-token"] = token;

    // IMPORTANT: never call /api/session here.
    // /api/session has "get-or-create" semantics, which can accidentally create
    // a brand-new unbound(meta) session when the old sessionId has expired.
    // That side effect is exactly what pollutes Meta history with short-id rows.
    const matchResp = await fetch(
      `${base}/api/sessions?avatar_id=${encodeURIComponent(expected)}`,
      { headers },
    );
    if (!matchResp.ok) return { kind: "unknown" };
    const matchData = (await matchResp.json()) as {
      sessions?: Array<{ session_id?: string | null }>;
    };
    const boundRows = Array.isArray(matchData.sessions) ? matchData.sessions : [];
    const sid = String(sessionId ?? "").trim();
    if (
      boundRows.some((row) => String(row?.session_id ?? "").trim() === sid)
    ) {
      return { kind: "match" };
    }

    // Not in expected automation bucket. Check global list once to infer label.
    const allResp = await fetch(`${base}/api/sessions`, { headers });
    if (!allResp.ok) return { kind: "unknown" };
    const allData = (await allResp.json()) as {
      sessions?: Array<{ session_id?: string | null; avatar_id?: string | null }>;
    };
    const allRows = Array.isArray(allData.sessions) ? allData.sessions : [];
    const current = allRows.find((row) => String(row?.session_id ?? "").trim() === sid);
    if (!current) return { kind: "unknown" };
    const avs = String(current.avatar_id ?? "").trim();
    const label = avs.length > 0 ? avs : "（空/元智能体会话）";
    return { kind: "mismatch", avatarLabel: label };
  } catch {
    return { kind: "unknown" };
  }
}

async function runAutomationTaskHttp(
  task: AutomationTaskData,
  options?: { sessionIdOverride?: string },
): Promise<{ ok: boolean; error?: string; sessionId?: string }> {
  const portFile = path.join(CONFIG_DIR, "serve.port");
  const tokenFile = path.join(CONFIG_DIR, "serve.token");
  if (!fs.existsSync(portFile)) {
    return { ok: false, error: "agx serve 未运行（缺少 serve.port）" };
  }
  const port = fs.readFileSync(portFile, "utf-8").trim();
  const token = fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, "utf-8").trim() : "";
  const base = `http://127.0.0.1:${port}`;
  let sessionId = resolveAutomationSessionId(task, options?.sessionIdOverride);
  if (!sessionId) {
    const newSid = await createAutomationTaskSession(base, token, task);
    if (!newSid) {
      return {
        ok: false,
        error:
          "无法自动创建定时任务专属会话：请确认本机 agx serve 已启动。若仍失败，可在侧栏「定时」中点击该任务打开聊天窗格后再试。",
      };
    }
    task.sessionId = newSid;
    persistAutomationTaskSession(task.id, newSid);
    sessionId = newSid;
  }
  const bind = await checkAutomationSessionBinding(base, token, task.id, sessionId);
  if (bind.kind === "mismatch") {
    const repairedSid = await createAutomationTaskSession(base, token, task);
    if (!repairedSid) {
      return {
        ok: false,
        sessionId,
        error: `会话与定时任务不匹配（当前绑定：${bind.avatarLabel}），自动创建 automation 专属会话失败。请在侧栏「定时」中打开该任务后再试。`,
      };
    }
    task.sessionId = repairedSid;
    persistAutomationTaskSession(task.id, repairedSid);
    sessionId = repairedSid;
  }
  const prompt = String(task.prompt ?? "").trim();
  if (!prompt) return { ok: false, error: "任务提示词为空" };
  const tid = String(task.id ?? "").trim();
  if (!tid) return { ok: false, error: "任务 id 无效" };

  const ac = new AbortController();
  automationRunControllers.set(tid, ac);
  const timeoutMs = resolveAutomationChatTimeoutMs();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const first = await invokeAutomationUserTurnWithSignal(
      base,
      token,
      sessionId,
      prompt,
      task.workspace,
      ac.signal,
      tid,
      timeoutMs,
    );
    if (first.ok) return { ...first, sessionId };

    const firstErr = String(first.error ?? "");
    if (!/HTTP\s*404/i.test(firstErr) && !/session not found/i.test(firstErr)) {
      return { ...first, sessionId };
    }

    const repairedSid = await createAutomationTaskSession(base, token, task);
    if (!repairedSid) {
      return {
        ok: false,
        sessionId,
        error: `会话失效且自动重建失败：${sanitizeAutomationRunError(firstErr) ?? "session not found"}`,
      };
    }

    task.sessionId = repairedSid;
    persistAutomationTaskSession(task.id, repairedSid);
    const second = await invokeAutomationUserTurnWithSignal(
      base,
      token,
      repairedSid,
      prompt,
      task.workspace,
      ac.signal,
      tid,
      timeoutMs,
    );
    if (second.ok) return { ...second, sessionId: repairedSid };
    return {
      ...second,
      sessionId: repairedSid,
      error: `会话已自动重建，但执行失败：${sanitizeAutomationRunError(second.error) ?? "未知错误"}`,
    };
  } finally {
    clearTimeout(timer);
    automationRunControllers.delete(tid);
    automationRunUserCancelled.delete(tid);
  }
}

class AutomationScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastCheckMinute = "";

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 30_000);
    this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  reload(): void {
    /* no-op: we load from disk each tick */
  }

  private tick(): void {
    const now = new Date();
    const minuteKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (minuteKey === this.lastCheckMinute) return;
    this.lastCheckMinute = minuteKey;

    const tasks = loadAutomationTasks();
    const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay(); // 1=Mon..7=Sun
    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const currentDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    let dirty = false;
    for (const task of tasks) {
      if (!task.enabled) continue;
      if (!this.isWithinDateRange(task, currentDate)) continue;
      if (!this.shouldRun(task, currentTime, currentDate, dayOfWeek)) continue;
      if (task.lastRunAt && task.lastRunAt.startsWith(minuteKey)) continue;

      task.lastRunAt = now.toISOString();
      dirty = true;
      emitAutomationTaskProgress({
        taskId: task.id,
        taskName: task.name,
        trigger: "schedule",
        phase: "queued",
        sessionId: resolveAutomationSessionId(task) || undefined,
        ts: Date.now(),
      });
      void this.executeTask(task);
    }
    if (dirty) saveAutomationTasks(tasks);
  }

  private isWithinDateRange(task: AutomationTaskData, currentDate: string): boolean {
    const range = task.effectiveDateRange;
    if (!range) return true;
    if (range.start && currentDate < range.start) return false;
    if (range.end && currentDate > range.end) return false;
    return true;
  }

  private shouldRun(task: AutomationTaskData, currentTime: string, currentDate: string, dayOfWeek: number): boolean {
    const freq = task.frequency;
    switch (freq.type) {
      case "daily":
        return freq.time === currentTime && freq.days.includes(dayOfWeek);
      case "interval": {
        if (!freq.days.includes(dayOfWeek)) return false;
        const hour = new Date().getHours();
        return hour % freq.hours === 0 && currentTime.endsWith(":00");
      }
      case "once":
        return freq.date === currentDate && freq.time === currentTime;
      default:
        return false;
    }
  }

  private async executeTask(task: AutomationTaskData): Promise<void> {
    try {
      emitAutomationTaskProgress({
        taskId: task.id,
        taskName: task.name,
        trigger: "schedule",
        phase: "running",
        sessionId: resolveAutomationSessionId(task) || undefined,
        ts: Date.now(),
      });
      const result = await runAutomationTaskHttp(task);
      const tasks = loadAutomationTasks();
      const found = tasks.find((t) => t.id === task.id);
      if (found) {
        found.lastRunStatus = result.ok ? "success" : "error";
        found.lastRunAt = new Date().toISOString();
        if (result.ok) {
          delete found.lastRunError;
        } else {
          found.lastRunError = sanitizeAutomationRunError(result.error) ?? "执行失败";
        }
        saveAutomationTasks(tasks);
      }
      emitAutomationTaskProgress({
        taskId: task.id,
        taskName: task.name,
        trigger: "schedule",
        phase: result.ok ? "success" : "error",
        sessionId: result.sessionId || resolveAutomationSessionId(task) || undefined,
        message: result.error,
        ts: Date.now(),
      });
    } catch (err) {
      const tasks = loadAutomationTasks();
      const found = tasks.find((t) => t.id === task.id);
      if (found) {
        found.lastRunStatus = "error";
        found.lastRunAt = new Date().toISOString();
        found.lastRunError = sanitizeAutomationRunError(err) ?? "执行异常";
        saveAutomationTasks(tasks);
      }
      emitAutomationTaskProgress({
        taskId: task.id,
        taskName: task.name,
        trigger: "schedule",
        phase: "error",
        sessionId: resolveAutomationSessionId(task) || undefined,
        message: String(err),
        ts: Date.now(),
      });
    }
  }
}

const automationScheduler = new AutomationScheduler();

const KNOWN_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  volcengine: "https://ark.cn-beijing.volces.com/api/v3",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  bailian: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  qianfan: "https://aip.baidubce.com/rpc/2.0/ai_custom/v1",
  minimax: "https://api.minimax.chat/v1",
  kimi: "https://api.moonshot.cn/v1",
};

const PROVIDER_FALLBACK_MODELS: Record<string, string[]> = {
  minimax: ["MiniMax-M2.5"],
};

function loadAgxConfig(): AgxConfig {
  if (!fs.existsSync(CONFIG_PATH)) return { version: "1", providers: {} };
  try {
    const raw = yaml.load(fs.readFileSync(CONFIG_PATH, "utf-8")) as AgxConfig;
    return raw ?? { version: "1", providers: {} };
  } catch {
    return { version: "1", providers: {} };
  }
}

function saveAgxConfig(cfg: AgxConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, yaml.dump(cfg, { lineWidth: -1 }), "utf-8");
}

function loadSoulFile(pathName: string): string {
  try {
    return fs.readFileSync(pathName, "utf-8");
  } catch {
    return "";
  }
}

function saveSoulFile(pathName: string, content: string): void {
  fs.mkdirSync(path.dirname(pathName), { recursive: true });
  fs.writeFileSync(pathName, content, "utf-8");
}

function resolveAvatarSoulPath(avatarId: string): string {
  const id = String(avatarId || "").trim();
  if (!id || !/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new Error("invalid avatar id");
  }
  const root = path.resolve(AVATARS_DIR);
  const target = path.resolve(path.join(AVATARS_DIR, id, "SOUL.md"));
  if (!target.startsWith(root + path.sep)) {
    throw new Error("avatar soul path outside root");
  }
  return target;
}

function normalizeEmailConfig(input: unknown): EmailConfig {
  if (!input || typeof input !== "object") return { ...DEFAULT_EMAIL_CONFIG };
  const row = input as Partial<EmailConfig>;
  return {
    enabled: Boolean(row.enabled ?? true),
    smtp_host: String(row.smtp_host ?? "").trim(),
    smtp_port: Number(row.smtp_port ?? 587) || 587,
    smtp_username: String(row.smtp_username ?? "").trim(),
    smtp_password: String(row.smtp_password ?? ""),
    smtp_use_tls: Boolean(row.smtp_use_tls ?? true),
    from_email: String(row.from_email ?? "").trim(),
    default_to_email: String(row.default_to_email ?? "bingzhenli@hotmail.com").trim() || "bingzhenli@hotmail.com",
  };
}

function parseBooleanStrict(value: unknown, field: string): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(lowered)) return true;
    if (["false", "0", "no", "off"].includes(lowered)) return false;
  }
  throw new Error(`${field} must be boolean`);
}

function loadEmailConfigFromAgx(cfg: AgxConfig): EmailConfig {
  const email = cfg.notifications?.email;
  return normalizeEmailConfig(email);
}

function loadComputerUseEnabled(cfg: AgxConfig): boolean {
  const raw = cfg.computer_use;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const e = (raw as { enabled?: unknown }).enabled;
  if (typeof e === "boolean") return e;
  if (typeof e === "string") {
    const lowered = e.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(lowered)) return true;
  }
  return false;
}

function parseBooleanLoose(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(lowered)) return true;
    if (["false", "0", "no", "off"].includes(lowered)) return false;
  }
  return fallback;
}

function loadTrinityConfig(cfg: AgxConfig): TrinityConfig {
  const raw = (cfg as Record<string, unknown>).agent_harness_trinity;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_TRINITY_CONFIG };
  const row = raw as Record<string, unknown>;
  return {
    skill_protocol: parseBooleanLoose(row.skill_protocol, DEFAULT_TRINITY_CONFIG.skill_protocol),
    session_summary: parseBooleanLoose(row.session_summary, DEFAULT_TRINITY_CONFIG.session_summary),
    learning_enabled: parseBooleanLoose(row.learning_enabled, DEFAULT_TRINITY_CONFIG.learning_enabled),
    skill_manage_enabled: parseBooleanLoose(row.skill_manage_enabled, DEFAULT_TRINITY_CONFIG.skill_manage_enabled),
  };
}

function validateEmailConfigPayload(input: unknown): { ok: true; config: EmailConfig } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "invalid payload: object required" };
  const payload = input as Record<string, unknown>;
  for (const key of Object.keys(payload)) {
    if (!EMAIL_CONFIG_KEYS.has(key)) {
      return { ok: false, error: `invalid field: ${key}` };
    }
  }
  let enabled: boolean;
  let smtpUseTls: boolean;
  try {
    enabled = parseBooleanStrict(payload.enabled, "enabled");
    smtpUseTls = parseBooleanStrict(payload.smtp_use_tls, "smtp_use_tls");
  } catch (err) {
    return { ok: false, error: String(err) };
  }
  let smtpPort = 587;
  try {
    smtpPort = intValue(payload.smtp_port, "smtp_port");
  } catch (err) {
    return { ok: false, error: String(err) };
  }
  const normalized: EmailConfig = {
    enabled,
    smtp_host: String(payload.smtp_host ?? "").trim(),
    smtp_port: smtpPort,
    smtp_username: String(payload.smtp_username ?? "").trim(),
    smtp_password: String(payload.smtp_password ?? ""),
    smtp_use_tls: smtpUseTls,
    from_email: String(payload.from_email ?? "").trim(),
    default_to_email: String(payload.default_to_email ?? "bingzhenli@hotmail.com").trim() || "bingzhenli@hotmail.com",
  };
  if (!normalized.smtp_host.trim()) return { ok: false, error: "smtp_host is required" };
  if (!normalized.smtp_username.trim()) return { ok: false, error: "smtp_username is required" };
  if (!normalized.smtp_password.trim()) return { ok: false, error: "smtp_password is required" };
  if (!normalized.from_email.trim()) return { ok: false, error: "from_email is required" };
  if (!normalized.default_to_email.trim()) return { ok: false, error: "default_to_email is required" };
  return { ok: true, config: normalized };
}

function intValue(raw: unknown, field: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new Error(`${field} must be integer`);
  return parsed;
}

function validateTrinityConfigPayload(input: unknown): { ok: true; config: TrinityConfig } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "invalid payload: object required" };
  const payload = input as Record<string, unknown>;
  for (const key of Object.keys(payload)) {
    if (!TRINITY_CONFIG_KEYS.has(key)) {
      return { ok: false, error: `invalid field: ${key}` };
    }
  }
  let skillProtocol: boolean;
  let sessionSummary: boolean;
  let learningEnabled: boolean;
  let skillManageEnabled: boolean;
  try {
    skillProtocol = parseBooleanStrict(payload.skill_protocol, "skill_protocol");
    sessionSummary = parseBooleanStrict(payload.session_summary, "session_summary");
    learningEnabled = parseBooleanStrict(payload.learning_enabled, "learning_enabled");
    skillManageEnabled = parseBooleanStrict(payload.skill_manage_enabled, "skill_manage_enabled");
  } catch (err) {
    return { ok: false, error: String(err) };
  }
  return {
    ok: true,
    config: {
      skill_protocol: skillProtocol,
      session_summary: sessionSummary,
      learning_enabled: learningEnabled,
      skill_manage_enabled: skillManageEnabled,
    },
  };
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let apiPort = 8000;
const apiToken = crypto.randomBytes(16).toString("hex");
let serveProcess: ChildProcess | null = null;
let feishuProcess: ChildProcess | null = null;
let wechatSidecarProcess: ChildProcess | null = null;
let wechatSidecarPort = 0;
let isQuitting = false;
let serveStdoutBuffer = "";
let serveStderrBuffer = "";
let remoteConfig: ResolvedRemoteConfig | null = null;
let skillsDirWatchers: fs.FSWatcher[] = [];
let skillsChangedDebounceTimer: NodeJS.Timeout | null = null;

function loadRemoteConfig(): ResolvedRemoteConfig | null {
  const cfg = loadAgxConfig();
  const rs = cfg.remote_server;
  if (!rs?.enabled) return null;
  const url = (rs.url || "").trim().replace(/\/+$/, "");
  if (!url) return null;
  return { url, token: (rs.token || "").trim() };
}

async function pingRemoteServer(config: ResolvedRemoteConfig, timeoutMs = 10000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${config.url}/api/session`, {
      headers: { "x-agx-desktop-token": config.token },
      signal: controller.signal,
    });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function getStudioUrl(): string {
  return remoteConfig ? remoteConfig.url : `http://127.0.0.1:${apiPort}`;
}

function getStudioToken(): string {
  return remoteConfig ? remoteConfig.token : apiToken;
}

function emitSkillsChanged(): void {
  if (skillsChangedDebounceTimer) {
    clearTimeout(skillsChangedDebounceTimer);
  }
  skillsChangedDebounceTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("skills-changed");
    }
  }, 300);
}

function emitAutomationTaskProgress(payload: AutomationTaskProgressPayload): void {
  const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  for (const win of wins) {
    win.webContents.send("automation-task-progress", payload);
  }
}

function buildSkillWatchRoots(): string[] {
  const roots = [
    path.join(CONFIG_DIR, "skills"),
    path.join(os.homedir(), ".agents", "skills"),
    path.join(os.homedir(), ".agent", "skills"),
    path.join(os.homedir(), ".claude", "skills"),
    path.join(os.homedir(), ".cursor", "skills"),
  ];
  // Project-local skill roots are useful in dev only. In packaged apps, cwd can
  // be "/" or app bundle internals; forcing mkdir there causes ENOENT/EACCES.
  if (!app.isPackaged) {
    roots.push(
      path.join(process.cwd(), ".agents", "skills"),
      path.join(process.cwd(), ".agent", "skills"),
      path.join(process.cwd(), ".claude", "skills"),
    );
  }
  const dedup = new Set<string>();
  for (const root of roots) {
    dedup.add(path.resolve(root));
  }
  return Array.from(dedup);
}

function startSkillsDirWatcher(): void {
  if (skillsDirWatchers.length > 0) return;
  const managedSkillsRoot = path.resolve(path.join(CONFIG_DIR, "skills"));
  for (const watchRoot of buildSkillWatchRoots()) {
    // Only create AgenticX-managed root. External roots should be watched iff present.
    if (watchRoot === managedSkillsRoot) {
      fs.mkdirSync(watchRoot, { recursive: true });
    } else if (!fs.existsSync(watchRoot)) {
      continue;
    }
    try {
      const one = fs.watch(
        watchRoot,
        { recursive: true },
        (_eventType, filename) => {
          const name = String(filename || "");
          if (!name || !name.endsWith("SKILL.md")) return;
          emitSkillsChanged();
        },
      );
      skillsDirWatchers.push(one);
    } catch (err) {
      console.warn("[main] skills watcher start failed:", watchRoot, err);
    }
  }
}

function stopSkillsDirWatcher(): void {
  if (skillsChangedDebounceTimer) {
    clearTimeout(skillsChangedDebounceTimer);
    skillsChangedDebounceTimer = null;
  }
  if (skillsDirWatchers.length > 0) {
    try {
      for (const one of skillsDirWatchers) {
        one.close();
      }
    } catch {
      /* noop */
    }
    skillsDirWatchers = [];
  }
}

// Suppress noisy Chromium network diagnostics
// (e.g. chunked upload stream warnings during aborted renderer requests).
// Set AGX_CHROMIUM_QUIET=0 to re-enable Chromium internals logs for debugging.
if (process.env.AGX_CHROMIUM_QUIET !== "0") {
  app.commandLine.appendSwitch("log-level", "3");
  app.commandLine.appendSwitch("disable-logging");
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to pick free port"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function buildMenuTemplate(): MenuItemConstructorOptions[] {
  if (process.platform === "darwin") {
    return [
      {
        label: "AgenticX",
        submenu: [
          { role: "about" },
          { type: "separator" },
          { label: "设置", click: () => mainWindow?.webContents.send("open-settings") },
          { type: "separator" },
          { role: "quit" }
        ]
      },
      {
        label: "Edit",
        submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }]
      },
      {
        label: "Window",
        submenu: [{ role: "minimize" }, { role: "close" }]
      }
    ];
  }
  return [
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" }
  ];
}

function pathListSeparator(): string {
  return process.platform === "win32" ? ";" : ":";
}

/** Editable / venv installs: agx lives under repo `.venv` while `npm run dev` cwd is usually `desktop/`. */
function repoAdjacentVenvBinDirs(): string[] {
  const cwd = process.cwd();
  const sub = process.platform === "win32" ? "Scripts" : "bin";
  const roots = [cwd, path.resolve(cwd, "..")];
  const out: string[] = [];
  for (const root of roots) {
    for (const name of [".venv", "venv"]) {
      const p = path.join(root, name, sub);
      try {
        if (fs.statSync(p).isDirectory()) {
          out.push(p);
        }
      } catch {
        /* noop */
      }
    }
  }
  return out;
}

function buildAugmentedPath(): string {
  const home = os.homedir();
  const sep = pathListSeparator();
  const basePath =
    process.env.PATH ?? (process.platform === "win32" ? "" : "/usr/bin:/bin");

  const venvDirs = repoAdjacentVenvBinDirs();
  let extraPaths: string[];
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    const appDataRoaming = process.env.APPDATA || "";
    const pyWinFolders = ["Python313", "Python312", "Python311", "Python310", "Python39", "Python38"];
    const programsPythonScripts = localAppData
      ? pyWinFolders.map((folder) => path.join(localAppData, "Programs", "Python", folder, "Scripts"))
      : [];
    const userSiteScripts = appDataRoaming
      ? pyWinFolders.map((folder) => path.join(appDataRoaming, "Python", folder, "Scripts"))
      : [];
    extraPaths = [
      ...venvDirs,
      ...programsPythonScripts,
      ...userSiteScripts,
      path.join(home, "miniconda3", "Scripts"),
      path.join(home, "miniconda3", "condabin"),
      path.join(home, "anaconda3", "Scripts"),
      path.join(home, "mambaforge", "Scripts"),
      path.join(home, "micromamba", "bin"),
      localAppData ? path.join(localAppData, "miniconda3", "Scripts") : "",
      localAppData ? path.join(localAppData, "anaconda3", "Scripts") : "",
      path.join(home, "scoop", "shims"),
    ].filter(Boolean);
  } else {
    // macOS pip --user installs to ~/Library/Python/X.Y/bin; enumerate common versions
    const pyUserBins = ["3.13", "3.12", "3.11", "3.10", "3.9"].map(
      (v) => `${home}/Library/Python/${v}/bin`
    );
    extraPaths = [
      ...venvDirs,
      ...pyUserBins,
      "/opt/miniconda3/bin",
      "/opt/miniconda3/condabin",
      `${home}/miniconda3/bin`,
      `${home}/opt/miniconda3/bin`,
      "/opt/homebrew/bin",
      "/usr/local/bin",
      `${home}/.local/bin`,
      `${home}/.pyenv/shims`,
      `${home}/.rye/shims`,
      `${home}/bin`,
    ];
  }
  const prefix = extraPaths.join(sep);
  return prefix ? `${prefix}${sep}${basePath}` : basePath;
}

/**
 * Spawn `agx` without a login shell.
 * macOS: `zsh -l -c` runs `/etc/zprofile` → `path_helper` rebuilds PATH and drops
 * conda/venv paths inherited from the parent Electron process, so `agx` vanishes.
 * Windows: prefer a resolved `agx.exe` path; bare `agx` can fail to spawn from Electron
 * when only `agx.cmd` exists or PATHEXT resolution differs from the login shell.
 */
function spawnAgx(
  resolvedExecutable: string | null,
  args: string[],
  options: { cwd?: string; stdio: ("ignore" | "pipe")[]; env: NodeJS.ProcessEnv }
): ChildProcess {
  const cmd = resolvedExecutable ?? "agx";
  return spawn(cmd, args, { ...options, shell: false });
}

/** Packaged macOS app: embedded PyInstaller binary under Resources/backend/agx-server */
function resolveBundledBackend(): string | null {
  if (!app.isPackaged || process.platform !== "darwin") {
    return null;
  }
  const binary = path.join(process.resourcesPath, "backend", "agx-server");
  if (fs.existsSync(binary)) {
    return binary;
  }
  return null;
}

function spawnBundledServer(
  binaryPath: string,
  args: string[],
  options: { cwd?: string; stdio: ("ignore" | "pipe")[]; env: NodeJS.ProcessEnv }
): ChildProcess {
  try {
    fs.chmodSync(binaryPath, 0o755);
  } catch {
    /* noop */
  }
  return spawn(binaryPath, args, { ...options, shell: false });
}

function findAgxBinaryOnPath(augmentedPath: string): string | null {
  const dirs = augmentedPath.split(pathListSeparator());
  const names = process.platform === "win32" ? ["agx.exe", "agx.cmd", "agx"] : ["agx"];
  const mode = process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK;
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, mode);
        return candidate;
      } catch { /* not here */ }
    }
  }
  return null;
}

async function checkAgxCli(): Promise<boolean> {
  const augmentedPath = buildAugmentedPath();
  const binaryPath = findAgxBinaryOnPath(augmentedPath);

  return new Promise((resolve) => {
    const proc = spawnAgx(binaryPath, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: augmentedPath },
    });
    let resolved = false;
    const done = (ok: boolean) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { proc.kill(); } catch { /* noop */ }
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), 30_000);
    proc.on("close", (code) => done(code === 0));
    proc.on("error", () => done(false));
  });
}

async function startStudioServe(): Promise<void> {
  apiPort = await pickFreePort();
  const desktopHome = os.homedir();

  // Persist actual port & token so in-process adapters (WeChat, Feishu) and
  // sibling processes discover the live agx serve instance, not a stale one.
  try {
    const portFile = path.join(os.homedir(), ".agenticx", "serve.port");
    const tokenFile = path.join(os.homedir(), ".agenticx", "serve.token");
    fs.mkdirSync(path.dirname(portFile), { recursive: true });
    fs.writeFileSync(portFile, String(apiPort));
    fs.writeFileSync(tokenFile, apiToken);
  } catch { /* best-effort */ }

  const augmentedPath = buildAugmentedPath();
  const bundledPath = resolveBundledBackend();
  const cfg = loadAgxConfig();
  const trinity = loadTrinityConfig(cfg);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: augmentedPath,
    AGX_DESKTOP_TOKEN: apiToken,
    AGX_WORKSPACE_ROOT: desktopHome,
    AGX_DESKTOP_UNRESTRICTED_FS: "1",
    AGX_SKILL_PROTOCOL: trinity.skill_protocol ? "true" : "false",
    AGX_SESSION_SUMMARY: trinity.session_summary ? "true" : "false",
    AGX_LEARNING_ENABLED: trinity.learning_enabled ? "true" : "false",
    AGX_SKILL_MANAGE: trinity.skill_manage_enabled ? "1" : "0",
  };

  const agxResolved = findAgxBinaryOnPath(augmentedPath);

  if (bundledPath) {
    serveProcess = spawnBundledServer(
      bundledPath,
      ["--host", "127.0.0.1", "--port", String(apiPort)],
      { cwd: desktopHome, stdio: ["ignore", "pipe", "pipe"], env }
    );
  } else {
    serveProcess = spawnAgx(
      agxResolved,
      ["serve", "--host", "127.0.0.1", "--port", String(apiPort)],
      { cwd: desktopHome, stdio: ["ignore", "pipe", "pipe"], env }
    );
  }
  serveStdoutBuffer = "";
  serveStderrBuffer = "";
  if (serveProcess.stdout) {
    serveProcess.stdout.on("data", (chunk: Buffer) => {
      serveStdoutBuffer = (serveStdoutBuffer + chunk.toString("utf-8")).slice(-4000);
    });
  }
  if (serveProcess.stderr) {
    serveProcess.stderr.on("data", (chunk: Buffer) => {
      serveStderrBuffer = (serveStderrBuffer + chunk.toString("utf-8")).slice(-4000);
    });
  }
}

async function waitServeReady(timeoutMs = 45000): Promise<void> {
  if (!serveProcess || !serveProcess.stdout || !serveProcess.stderr) {
    throw new Error("agx serve process not started");
  }
  const currentProcess = serveProcess;
  const currentStdout = currentProcess.stdout!;
  const currentStderr = currentProcess.stderr!;
  const pingReady = async (): Promise<boolean> => {
    try {
      const resp = await fetch(`${getStudioUrl()}/api/session`, {
        headers: { "x-agx-desktop-token": getStudioToken() },
      });
      return resp.ok;
    } catch {
      return false;
    }
  };
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      const stderrTail = serveStderrBuffer.trim().slice(-1200);
      const stdoutTail = serveStdoutBuffer.trim().slice(-1200);
      const detail = [message, stderrTail && `stderr:\n${stderrTail}`, stdoutTail && `stdout:\n${stdoutTail}`]
        .filter(Boolean)
        .join("\n\n");
      reject(new Error(detail));
    };
    const markReady = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      void (async () => {
        if (await pingReady()) {
          markReady();
          return;
        }
        fail("agx serve startup timeout");
      })();
    }, timeoutMs);
    const probeTimer = setInterval(() => {
      void (async () => {
        if (settled) return;
        if (await pingReady()) {
          markReady();
        }
      })();
    }, 500);
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      if (text.includes("Uvicorn running") || text.includes("AgenticX Studio Server")) {
        markReady();
      }
    };
    const onErrData = (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      if (text.includes("Uvicorn running") || text.includes("AgenticX Studio Server")) {
        markReady();
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      fail(`agx serve exited before ready (code=${String(code)}, signal=${String(signal)})`);
    };
    const onError = (err: Error) => {
      fail(`agx serve failed to start: ${err.message}`);
    };
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(probeTimer);
      currentStdout.off("data", onData);
      currentStderr.off("data", onErrData);
      currentProcess.off("exit", onExit);
      currentProcess.off("error", onError);
    };
    currentStdout.on("data", onData);
    currentStderr.on("data", onErrData);
    currentProcess.on("exit", onExit);
    currentProcess.on("error", onError);
  });
}

function stopStudioServe(): void {
  if (!serveProcess) {
    return;
  }
  try {
    serveProcess.kill("SIGTERM");
  } catch {
    // noop
  } finally {
    serveProcess = null;
    serveStdoutBuffer = "";
    serveStderrBuffer = "";
  }
}

function startFeishuProcess(): void {
  const cfg = loadAgxConfig();
  const lc = cfg.feishu_longconn;
  if (!lc?.enabled || !lc.app_id || !lc.app_secret) return;
  if (feishuProcess && !feishuProcess.killed) return;
  const augmentedPath = buildAugmentedPath();
  const agxResolved = findAgxBinaryOnPath(augmentedPath);
  feishuProcess = spawnAgx(
    agxResolved,
    ["feishu", "--app-id", lc.app_id, "--app-secret", lc.app_secret],
    { cwd: os.homedir(), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PATH: augmentedPath } }
  );
  feishuProcess.on("exit", (code) => {
    if (!isQuitting) {
      console.info(`[feishu] process exited (code=${String(code)}), will not auto-restart`);
    }
    feishuProcess = null;
  });
}

function stopFeishuProcess(): void {
  if (!feishuProcess) return;
  try { feishuProcess.kill("SIGTERM"); } catch { /* noop */ }
  feishuProcess = null;
}

// ── WeChat iLink Sidecar ──────────────────────────────────────────

function getWechatSidecarPath(): string {
  if (app.isPackaged) {
    // electron-builder.yml: mac.extraResources maps bundled-backend/${arch} -> Resources/backend/
    const backendPath = path.join(process.resourcesPath, "backend", "agx-wechat-sidecar");
    if (fs.existsSync(backendPath)) return backendPath;
    const resPath = path.join(process.resourcesPath, "agx-wechat-sidecar");
    if (fs.existsSync(resPath)) return resPath;
    const arch = process.arch === "x64" ? "x64" : "arm64";
    const bundled = path.join(process.resourcesPath, "bundled-backend", arch, "agx-wechat-sidecar");
    if (fs.existsSync(bundled)) return bundled;
    return backendPath;
  }
  const devPath = path.join(__dirname, "..", "..", "packaging", "wechat-sidecar", "agx-wechat-sidecar");
  if (fs.existsSync(devPath)) return devPath;
  return "agx-wechat-sidecar";
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

let wechatRestartCount = 0;
const WECHAT_MAX_RESTARTS = 3;
let wechatHealthTimer: ReturnType<typeof setInterval> | null = null;

async function startWechatSidecar(): Promise<void> {
  if (wechatSidecarProcess && !wechatSidecarProcess.killed) return;
  const binaryPath = getWechatSidecarPath();
  if (!fs.existsSync(binaryPath)) {
    console.info("[wechat-sidecar] binary not found:", binaryPath);
    return;
  }
  try {
    const port = await findFreePort();
    const dataDir = path.join(os.homedir(), ".agenticx");
    const args = ["--port", String(port), "--data-dir", dataDir];
    // Minimal spawn context for diagnosing unknown runtime flags.
    console.info("[wechat-sidecar] spawn command", {
      binaryPath,
      args,
      nodeOptions: process.env.NODE_OPTIONS ?? "",
      electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE ?? "",
    });
    wechatSidecarProcess = spawn(binaryPath, args, {
      cwd: os.homedir(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    wechatSidecarPort = port;
    wechatSidecarProcess.stdout?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) console.info("[wechat-sidecar]", line);
    });
    wechatSidecarProcess.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) console.warn("[wechat-sidecar:err]", line);
    });
    wechatSidecarProcess.on("exit", (code) => {
      if (!isQuitting) {
        console.info(`[wechat-sidecar] exited (code=${String(code)})`);
        if (wechatRestartCount < WECHAT_MAX_RESTARTS) {
          wechatRestartCount++;
          console.info(`[wechat-sidecar] auto-restart attempt ${wechatRestartCount}/${WECHAT_MAX_RESTARTS}`);
          setTimeout(() => void startWechatSidecar(), 2000);
        }
      }
      wechatSidecarProcess = null;
      wechatSidecarPort = 0;
    });
    wechatRestartCount = 0;
    startWechatHealthCheck();
    console.info("[wechat-sidecar] started on port", port);
  } catch (err) {
    console.error("[wechat-sidecar] start failed:", err);
  }
}

function stopWechatSidecar(): void {
  stopWechatHealthCheck();
  if (!wechatSidecarProcess) return;
  try { wechatSidecarProcess.kill("SIGTERM"); } catch { /* noop */ }
  wechatSidecarProcess = null;
  wechatSidecarPort = 0;
}

function startWechatHealthCheck(): void {
  stopWechatHealthCheck();
  wechatHealthTimer = setInterval(async () => {
    if (!wechatSidecarPort || !wechatSidecarProcess) return;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(`http://127.0.0.1:${wechatSidecarPort}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) throw new Error(`health check: ${resp.status}`);
    } catch {
      console.warn("[wechat-sidecar] health check failed");
    }
  }, 30_000);
}

function stopWechatHealthCheck(): void {
  if (wechatHealthTimer) {
    clearInterval(wechatHealthTimer);
    wechatHealthTimer = null;
  }
}

type PtyTerminalSession = {
  kind: "pty";
  pty: import("node-pty").IPty;
  wc: Electron.WebContents;
};

type BridgeTerminalSession = {
  kind: "bridge";
  wc: Electron.WebContents;
  baseUrl: string;
  token: string;
  sessionId: string;
  abort: AbortController;
};

type TerminalSession = PtyTerminalSession | BridgeTerminalSession;

const terminalSessions = new Map<string, TerminalSession>();

function requireNodePty(): typeof import("node-pty") | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("node-pty") as typeof import("node-pty");
  } catch (err) {
    console.error("[terminal] failed to load node-pty:", err);
    return null;
  }
}

function killTerminalSession(id: string): void {
  const sess = terminalSessions.get(id);
  if (!sess) return;
  terminalSessions.delete(id);
  if (sess.kind === "bridge") {
    try {
      sess.abort.abort();
    } catch {
      // noop
    }
    return;
  }
  try {
    sess.pty.kill();
  } catch {
    // noop
  }
}

function killAllTerminalSessions(): void {
  for (const id of [...terminalSessions.keys()]) {
    killTerminalSession(id);
  }
}

/** Escape minimal HTML for inline error pages (load failures). */
function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseHttpUrl(value: string): URL | null {
  try {
    const u = new URL(value);
    if (u.protocol === "http:" || u.protocol === "https:") return u;
    return null;
  } catch {
    return null;
  }
}

function shouldOpenInExternalBrowser(targetUrl: string, appUrl: string): boolean {
  const target = parseHttpUrl(targetUrl);
  if (!target) return false;
  const appParsed = parseHttpUrl(appUrl);
  if (!appParsed) return true;
  return target.origin !== appParsed.origin;
}

function createWindow(): void {
  const vibrancyEnabled = process.env.AGX_ENABLE_VIBRANCY === "1";
  const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";
  const appEntryUrl = app.isPackaged
    ? `file://${path.join(__dirname, "..", "dist", "index.html")}`
    : devUrl;
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 680,
    minHeight: 480,
    show: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    titleBarStyle: "hiddenInset",
    ...(vibrancyEnabled ? { vibrancy: "under-window" as const, visualEffectState: "followWindow" as const } : {}),
    backgroundColor: "#00000000",
    roundedCorners: true,
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });
  const tryOpenExternalBrowser = (targetUrl: string): boolean => {
    if (!shouldOpenInExternalBrowser(targetUrl, appEntryUrl)) return false;
    void shell.openExternal(targetUrl);
    return true;
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (tryOpenExternalBrowser(url)) return { action: "deny" };
    return { action: "allow" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!tryOpenExternalBrowser(url)) return;
    event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  if (app.isPackaged) {
    const indexPath = path.join(__dirname, "..", "dist", "index.html");
    void mainWindow.loadFile(indexPath).catch((err) => {
      const detail = escapeHtmlText(String(err));
      void mainWindow
        ?.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(
            `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:SF Pro Text,PingFang SC,sans-serif;background:#14141c;color:rgba(255,255,255,.7);padding:1.5rem;box-sizing:border-box;-webkit-app-region:drag"><div style="text-align:center;max-width:36rem"><h3 style="margin:0">无法加载 Machi 界面</h3><p style="margin-top:.75rem;font-size:.85rem;opacity:.85;white-space:pre-wrap;word-break:break-all">${detail}</p><p style="margin-top:.5rem;font-size:.8rem;opacity:.6">请重新安装应用或从源码构建。</p></div></body></html>`
          )}`
        )
        .then(() => {
          mainWindow?.show();
        });
    });
  } else {
    void mainWindow.loadURL(devUrl).catch(() => {
      const distFallback = path.join(__dirname, "..", "dist", "index.html");
      if (fs.existsSync(distFallback)) {
        void mainWindow?.loadFile(distFallback).catch(() => {
          void mainWindow
            ?.loadURL(
              `data:text/html;charset=utf-8,${encodeURIComponent(
                `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:SF Pro Text,PingFang SC,sans-serif;background:#14141c;color:rgba(255,255,255,.7);-webkit-app-region:drag"><div style="text-align:center"><h3 style="margin:0">无法连接到开发服务器</h3><p style="margin-top:.5rem;font-size:.85rem;opacity:.6">请确保已运行 <code>npm run dev</code></p></div></body></html>`
              )}`
            )
            .then(() => {
              mainWindow?.show();
            });
        });
      } else {
        void mainWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(
          `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:SF Pro Text,PingFang SC,sans-serif;background:#14141c;color:rgba(255,255,255,.7);-webkit-app-region:drag"><div style="text-align:center"><h3 style="margin:0">无法连接到开发服务器</h3><p style="margin-top:.5rem;font-size:.85rem;opacity:.6">请确保已运行 <code>npm run dev</code></p></div></body></html>`
        )}`).then(() => {
          mainWindow?.show();
        });
      }
    });
  }
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray(): void {
  const iconPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(process.cwd(), "assets", "trayTemplate.png")
      : path.join(process.resourcesPath, "assets", "trayTemplate.png");
  if (!fs.existsSync(iconPath)) {
    return;
  }
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  const menu = Menu.buildFromTemplate([
    {
      label: "打开/隐藏窗口",
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { label: "设置", click: () => mainWindow?.webContents.send("open-settings") },
    { type: "separator" },
    { label: "退出", click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  tray.setToolTip("Machi");
}

/**
 * Register IPC handlers that must be available before agx serve starts.
 * The renderer may invoke these immediately on load (before the backend is ready),
 * so they need to be registered as early as possible in app.whenReady().
 */
function registerEarlyIpc(): void {
  ipcMain.handle("get-api-base", async () => getStudioUrl());
  ipcMain.handle("get-api-auth-token", async () => getStudioToken());
  ipcMain.handle("get-platform", async () => process.platform);
  ipcMain.handle("get-connection-mode", async () => remoteConfig ? "remote" : "local");

  ipcMain.handle("load-config", async () => {
    const cfg = loadAgxConfig();
    return {
      defaultProvider: cfg.default_provider ?? "",
      providers: cfg.providers ?? {},
      userMode: cfg.user_mode ?? "pro",
      onboardingCompleted: cfg.onboarding_completed ?? false,
      confirmStrategy: cfg.confirm_strategy ?? "semi-auto",
      activeProvider: cfg.active_provider ?? "",
      activeModel: cfg.active_model ?? "",
    };
  });

  // Session list: renderer may call this as soon as the window loads; register before agx serve / registerIpc().
  ipcMain.handle("list-sessions", async (_event, avatarId?: string) => {
    try {
      const params = avatarId ? `?avatar_id=${encodeURIComponent(avatarId)}` : "";
      const resp = await fetch(`${getStudioUrl()}/api/sessions${params}`, {
        headers: { "x-agx-desktop-token": getStudioToken() },
      });
      if (!resp.ok) return { ok: false, sessions: [] };
      return await resp.json();
    } catch {
      return { ok: false, sessions: [] };
    }
  });
}

function registerIpc(): void {
  // get-api-base, get-api-auth-token, get-platform, get-connection-mode, load-config
  // are registered early in registerEarlyIpc() — skip here to avoid duplicate handler errors.

  ipcMain.handle("load-remote-server", async () => {
    const cfg = loadAgxConfig();
    const rs = cfg.remote_server;
    return {
      enabled: rs?.enabled ?? false,
      url: rs?.url ?? "",
      token: rs?.token ?? "",
    };
  });

  ipcMain.handle("save-remote-server", async (_event, payload: {
    enabled: boolean;
    url: string;
    token: string;
  }) => {
    const cfg = loadAgxConfig();
    cfg.remote_server = {
      enabled: payload.enabled,
      url: (payload.url || "").trim().replace(/\/+$/, ""),
      token: (payload.token || "").trim(),
    };
    saveAgxConfig(cfg);
    return { ok: true, restart_required: true };
  });

  ipcMain.handle("test-remote-server", async (_event, payload: {
    url: string;
    token: string;
  }) => {
    const url = (payload.url || "").trim().replace(/\/+$/, "");
    if (!url) return { ok: false, error: "URL is required" };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const resp = await fetch(`${url}/api/session`, {
        headers: { "x-agx-desktop-token": (payload.token || "").trim() },
        signal: controller.signal,
      });
      clearTimeout(timer);
      return { ok: resp.ok, status: resp.status };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("load-gateway-im", async () => {
    const cfg = loadAgxConfig();
    const gw = cfg.gateway;
    return {
      enabled: gw?.enabled ?? false,
      url: gw?.url ?? "",
      deviceId: gw?.device_id ?? "",
      token: gw?.token ?? "",
      studioBaseUrl: gw?.studio_base_url ?? "",
    };
  });

  ipcMain.handle("save-gateway-im", async (_event, payload: {
    enabled: boolean;
    url: string;
    deviceId: string;
    token: string;
    studioBaseUrl: string;
  }) => {
    const cfg = loadAgxConfig();
    cfg.gateway = {
      enabled: payload.enabled,
      url: (payload.url || "").trim().replace(/\/+$/, ""),
      device_id: (payload.deviceId || "").trim(),
      token: (payload.token || "").trim(),
      studio_base_url: (payload.studioBaseUrl || "").trim().replace(/\/+$/, ""),
    };
    saveAgxConfig(cfg);
    return { ok: true, restart_required: true };
  });

  ipcMain.handle("load-feishu-config", async () => {
    const cfg = loadAgxConfig();
    const lc = cfg.feishu_longconn;
    return {
      enabled: lc?.enabled ?? false,
      appId: lc?.app_id ?? "",
      appSecret: lc?.app_secret ?? "",
    };
  });

  ipcMain.handle("save-feishu-config", async (_event, payload: {
    enabled: boolean;
    appId: string;
    appSecret: string;
  }) => {
    const cfg = loadAgxConfig();
    cfg.feishu_longconn = {
      enabled: payload.enabled,
      app_id: (payload.appId || "").trim(),
      app_secret: (payload.appSecret || "").trim(),
    };
    saveAgxConfig(cfg);
    // Restart feishu process with new config
    stopFeishuProcess();
    if (payload.enabled) startFeishuProcess();
    return { ok: true };
  });

  ipcMain.handle("load-feishu-binding", async () => {
    try {
      const raw = fs.readFileSync(FEISHU_BINDING_PATH, "utf-8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      return { ok: true, bindings: data };
    } catch {
      return { ok: true, bindings: {} as Record<string, unknown> };
    }
  });

  ipcMain.handle("save-feishu-desktop-binding", async (_event, payload: {
    sessionId: string | null;
    avatarId?: string | null;
    avatarName?: string | null;
    provider?: string | null;
    model?: string | null;
  }) => {
    let data: Record<string, unknown> = {};
    try {
      const raw = fs.readFileSync(FEISHU_BINDING_PATH, "utf-8");
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      /* empty */
    }
    const sid = (payload.sessionId || "").trim();
    if (!sid) {
      delete data[FEISHU_DESKTOP_BINDING_KEY];
    } else {
      const aid = (payload.avatarId ?? "").toString().trim();
      const aname = (payload.avatarName ?? "").toString().trim();
      const provider = (payload.provider ?? "").toString().trim();
      const model = (payload.model ?? "").toString().trim();
      data[FEISHU_DESKTOP_BINDING_KEY] = {
        session_id: sid,
        avatar_id: aid || null,
        avatar_name: aname || null,
        provider: provider || null,
        model: model || null,
        bound_at: new Date().toISOString(),
      };
    }
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(FEISHU_BINDING_PATH, JSON.stringify(data, null, 2), "utf-8");
    return { ok: true };
  });

  // ── WeChat iLink Sidecar IPC ──────────────────────────────────

  ipcMain.handle("wechat-sidecar-start", async () => {
    await startWechatSidecar();
    return { ok: true, port: wechatSidecarPort };
  });

  ipcMain.handle("wechat-sidecar-stop", async () => {
    stopWechatSidecar();
    return { ok: true };
  });

  ipcMain.handle("wechat-sidecar-port", async () => {
    return { port: wechatSidecarPort, running: !!wechatSidecarProcess && !wechatSidecarProcess.killed };
  });

  ipcMain.handle("load-wechat-binding", async () => {
    try {
      const raw = fs.readFileSync(WECHAT_BINDING_PATH, "utf-8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      return { ok: true, bindings: data };
    } catch {
      return { ok: true, bindings: {} as Record<string, unknown> };
    }
  });

  ipcMain.handle("save-wechat-desktop-binding", async (_event, payload: {
    sessionId: string | null;
    avatarId?: string | null;
    avatarName?: string | null;
    provider?: string | null;
    model?: string | null;
  }) => {
    let data: Record<string, unknown> = {};
    try {
      const raw = fs.readFileSync(WECHAT_BINDING_PATH, "utf-8");
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      /* empty */
    }
    const sid = (payload.sessionId || "").trim();
    if (!sid) {
      delete data[WECHAT_DESKTOP_BINDING_KEY];
    } else {
      const aid = (payload.avatarId ?? "").toString().trim();
      const aname = (payload.avatarName ?? "").toString().trim();
      const provider = (payload.provider ?? "").toString().trim();
      const model = (payload.model ?? "").toString().trim();
      data[WECHAT_DESKTOP_BINDING_KEY] = {
        session_id: sid,
        avatar_id: aid || null,
        avatar_name: aname || null,
        provider: provider || null,
        model: model || null,
        bound_at: new Date().toISOString(),
      };
    }
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(WECHAT_BINDING_PATH, JSON.stringify(data, null, 2), "utf-8");
    return { ok: true };
  });

  ipcMain.handle("list-avatars", async () => {
    try {
      const resp = await fetch(`${getStudioUrl()}/api/avatars`, {
        headers: { "x-agx-desktop-token": getStudioToken() },
      });
      if (!resp.ok) return { ok: false, avatars: [] };
      return await resp.json();
    } catch {
      return { ok: false, avatars: [] };
    }
  });

  ipcMain.handle("create-avatar", async (_event, payload: {
    name: string;
    role?: string;
    avatar_url?: string;
    system_prompt?: string;
    created_by?: string;
    tools_enabled?: Record<string, boolean>;
    skills_enabled?: Record<string, boolean> | null;
  }) => {
    try {
      const resp = await fetch(`${getStudioUrl()}/api/avatars`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": getStudioToken() },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("update-avatar", async (_event, payload: {
    id: string;
    name?: string;
    role?: string;
    avatar_url?: string;
    pinned?: boolean;
    system_prompt?: string;
    tools_enabled?: Record<string, boolean>;
    skills_enabled?: Record<string, boolean> | null;
  }) => {
    const { id, ...body } = payload;
    try {
      const resp = await fetch(`${getStudioUrl()}/api/avatars/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": getStudioToken() },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("delete-avatar", async (_event, id: string) => {
    try {
      const resp = await fetch(`${getStudioUrl()}/api/avatars/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "x-agx-desktop-token": getStudioToken() },
      });
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("get-tools-status", async () => {
    try {
      const resp = await fetch(`${getStudioUrl()}/api/tools/status`, {
        headers: { "x-agx-desktop-token": getStudioToken() },
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, tools: [], error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, tools: [], error: String(err) };
    }
  });

  ipcMain.handle("get-tools-registry", async () => {
    try {
      const resp = await fetch(`${getStudioUrl()}/api/tools/registry`, {
        headers: { "x-agx-desktop-token": getStudioToken() },
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, tools: [], error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, tools: [], error: String(err) };
    }
  });

  ipcMain.handle("get-tools-policy", async () => {
    try {
      const resp = await fetch(`${getStudioUrl()}/api/tools/policy`, {
        headers: { "x-agx-desktop-token": getStudioToken() },
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, tools_enabled: {}, tools_options: {}, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, tools_enabled: {}, tools_options: {}, error: String(err) };
    }
  });

  ipcMain.handle(
    "save-tools-policy",
    async (
      _event,
      payload: {
        tools_enabled?: Record<string, boolean>;
        tools_options?: Record<string, unknown>;
      },
    ) => {
    try {
      const body: Record<string, unknown> = { tools_enabled: payload?.tools_enabled ?? {} };
      if (payload && "tools_options" in payload) {
        body.tools_options = payload.tools_options;
      }
      const resp = await fetch(`${getStudioUrl()}/api/tools/policy`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-agx-desktop-token": getStudioToken(),
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("install-tool", async (event, payload: { requestId: string; toolId: string }) => {
    const requestId = String(payload?.requestId || "").trim();
    const toolId = String(payload?.toolId || "").trim();
    if (!requestId) return { ok: false, error: "requestId is required" };
    if (!toolId) return { ok: false, error: "toolId is required" };
    try {
      const resp = await fetch(`${getStudioUrl()}/api/tools/install`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agx-desktop-token": getStudioToken(),
        },
        body: JSON.stringify({ tool_id: toolId }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        event.sender.send("tool-install-progress", {
          requestId,
          tool_id: toolId,
          phase: "error",
          percent: 0,
          message: `HTTP ${resp.status}: ${body.slice(0, 300)}`,
        });
        return { ok: false, error: `HTTP ${resp.status}` };
      }
      if (!resp.body) {
        event.sender.send("tool-install-progress", {
          requestId,
          tool_id: toolId,
          phase: "error",
          percent: 0,
          message: "Empty stream body",
        });
        return { ok: false, error: "Empty stream body" };
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      const flushChunk = (rawChunk: string) => {
        const lines = rawChunk.split("\n");
        let eventName = "message";
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (eventName !== "progress" || dataLines.length === 0) return;
        const jsonText = dataLines.join("\n");
        try {
          const payloadData = JSON.parse(jsonText) as Record<string, unknown>;
          event.sender.send("tool-install-progress", {
            requestId,
            ...payloadData,
          });
        } catch (err) {
          event.sender.send("tool-install-progress", {
            requestId,
            tool_id: toolId,
            phase: "error",
            percent: 0,
            message: `Failed to parse install stream: ${String(err)}`,
          });
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) flushChunk(chunk);
      }
      const tail = buffer.trim();
      if (tail) flushChunk(tail);
      return { ok: true };
    } catch (err) {
      event.sender.send("tool-install-progress", {
        requestId,
        tool_id: toolId,
        phase: "error",
        percent: 0,
        message: String(err),
      });
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("create-session", async (_event, payload: { avatar_id?: string; name?: string; inherit_from_session_id?: string }) => {
    try {
      const resp = await fetch(`${getStudioUrl()}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": getStudioToken() },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const b = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${b.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("rename-session", async (_event, payload: { sessionId: string; name: string }) => {
    try {
      const resp = await fetch(`${getStudioUrl()}/api/sessions/${encodeURIComponent(payload.sessionId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": getStudioToken() },
        body: JSON.stringify({ name: payload.name }),
      });
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("delete-session", async (_event, sessionId: string) => {
    const sid = String(sessionId || "").trim();
    if (!sid) return { ok: false, error: "sessionId is required" };
    try {
      const resp = await fetch(
        `${getStudioUrl()}/api/session?session_id=${encodeURIComponent(sid)}`,
        {
          method: "DELETE",
          headers: { "x-agx-desktop-token": getStudioToken() },
        }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      const result = await resp.json();
      if (result?.ok !== false) {
        clearWechatDesktopBindingIfDeleted([sid]);
      }
      return result;
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("delete-sessions-batch", async (_event, sessionIds: string[]) => {
    const ids = Array.isArray(sessionIds)
      ? Array.from(new Set(sessionIds.map((id) => String(id || "").trim()).filter(Boolean)))
      : [];
    if (ids.length === 0) return { ok: true, deleted: [], failed: [] };
    try {
      const resp = await fetch(`${getStudioUrl()}/api/sessions/batch-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": getStudioToken() },
        body: JSON.stringify({ session_ids: ids }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}`, deleted: [], failed: ids };
      }
      const result = (await resp.json()) as {
        ok?: boolean;
        deleted?: string[];
        failed?: string[];
      };
      if (result?.ok !== false) {
        const deleted =
          Array.isArray(result?.deleted) && result.deleted.length > 0
            ? result.deleted
            : ids.filter((sid) => !new Set((result?.failed ?? []).map((x) => String(x || "").trim())).has(sid));
        clearWechatDesktopBindingIfDeleted(deleted);
      }
      return result;
    } catch (err) {
      return { ok: false, error: String(err), deleted: [], failed: ids };
    }
  });

  ipcMain.handle("pin-session", async (_event, payload: { sessionId: string; pinned: boolean }) => {
    const sid = String(payload?.sessionId || "").trim();
    if (!sid) return { ok: false, error: "sessionId is required" };
    try {
      const resp = await fetch(`${getStudioUrl()}/api/sessions/${encodeURIComponent(sid)}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": getStudioToken() },
        body: JSON.stringify({ pinned: !!payload.pinned }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("fork-session", async (_event, payload: { sessionId: string }) => {
    const sid = String(payload?.sessionId || "").trim();
    if (!sid) return { ok: false, error: "sessionId is required" };
    try {
      const resp = await fetch(`${getStudioUrl()}/api/sessions/${encodeURIComponent(sid)}/fork`, {
        method: "POST",
        headers: { "x-agx-desktop-token": getStudioToken() },
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("archive-sessions", async (_event, payload: { sessionId: string; avatarId?: string | null }) => {
    const sid = String(payload?.sessionId || "").trim();
    const avatarId = String(payload?.avatarId || "").trim();
    if (!sid) return { ok: false, error: "sessionId is required" };
    try {
      const resp = await fetch(`${getStudioUrl()}/api/sessions/archive-before`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": getStudioToken() },
        body: JSON.stringify({ session_id: sid, avatar_id: avatarId || undefined }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("list-taskspaces", async (_event, sessionId: string) => {
    const sid = String(sessionId || "").trim();
    if (!sid) return { ok: false, workspaces: [], error: "sessionId is required" };
    try {
      const resp = await fetch(
        `${getStudioUrl()}/api/taskspace/workspaces?session_id=${encodeURIComponent(sid)}`,
        {
          headers: { "x-agx-desktop-token": getStudioToken() },
        }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, workspaces: [], error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, workspaces: [], error: String(err) };
    }
  });

  ipcMain.handle("add-taskspace", async (_event, payload: { sessionId: string; path?: string; label?: string }) => {
    const sid = String(payload?.sessionId || "").trim();
    const dirPath = String(payload?.path || "").trim();
    const label = String(payload?.label || "").trim();
    if (!sid) return { ok: false, error: "sessionId is required" };
    try {
      const resp = await fetch(`${getStudioUrl()}/api/taskspace/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": getStudioToken() },
        body: JSON.stringify({ session_id: sid, path: dirPath || undefined, label: label || undefined }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("remove-taskspace", async (_event, payload: { sessionId: string; taskspaceId: string }) => {
    const sid = String(payload?.sessionId || "").trim();
    const taskspaceId = String(payload?.taskspaceId || "").trim();
    if (!sid || !taskspaceId) return { ok: false, error: "sessionId and taskspaceId are required" };
    try {
      const resp = await fetch(`${getStudioUrl()}/api/taskspace/workspaces`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": getStudioToken() },
        body: JSON.stringify({ session_id: sid, taskspace_id: taskspaceId }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("choose-directory", async () => {
    if (remoteConfig) {
      return { ok: false, error: "远程模式不支持本地目录选择" };
    }
    const focused = BrowserWindow.getFocusedWindow() ?? mainWindow ?? null;
    try {
      const result = focused
        ? await dialog.showOpenDialog(focused, { properties: ["openDirectory"] })
        : await dialog.showOpenDialog({ properties: ["openDirectory"] });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, canceled: true };
      }
      return { ok: true, path: result.filePaths[0] };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("list-taskspace-files", async (_event, payload: { sessionId: string; taskspaceId: string; path?: string }) => {
    const sid = String(payload?.sessionId || "").trim();
    const taskspaceId = String(payload?.taskspaceId || "").trim();
    const relPath = String(payload?.path || ".").trim() || ".";
    if (!sid || !taskspaceId) return { ok: false, files: [], error: "sessionId and taskspaceId are required" };
    try {
      const query = `session_id=${encodeURIComponent(sid)}&taskspace_id=${encodeURIComponent(taskspaceId)}&path=${encodeURIComponent(relPath)}`;
      const resp = await fetch(`${getStudioUrl()}/api/taskspace/files?${query}`, {
        headers: { "x-agx-desktop-token": getStudioToken() },
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, files: [], error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, files: [], error: String(err) };
    }
  });

  ipcMain.handle("read-taskspace-file", async (_event, payload: { sessionId: string; taskspaceId: string; path: string }) => {
    const sid = String(payload?.sessionId || "").trim();
    const taskspaceId = String(payload?.taskspaceId || "").trim();
    const relPath = String(payload?.path || "").trim();
    if (!sid || !taskspaceId || !relPath) {
      return { ok: false, error: "sessionId, taskspaceId and path are required" };
    }
    try {
      const query = `session_id=${encodeURIComponent(sid)}&taskspace_id=${encodeURIComponent(taskspaceId)}&path=${encodeURIComponent(relPath)}`;
      const resp = await fetch(`${getStudioUrl()}/api/taskspace/file?${query}`, {
        headers: { "x-agx-desktop-token": getStudioToken() },
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("load-session-messages", async (_event, sessionId: string) => {
    const sid = String(sessionId || "").trim();
    if (!sid) return { ok: false, messages: [], error: "sessionId is required" };
    try {
      const resp = await fetch(
        `${getStudioUrl()}/api/session/messages?session_id=${encodeURIComponent(sid)}`,
        {
          headers: { "x-agx-desktop-token": getStudioToken() },
        }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, messages: [], error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, messages: [], error: String(err) };
    }
  });

  ipcMain.handle("fork-avatar", async (_event, payload: { sessionId: string; name: string; role?: string }) => {
    try {
      const resp = await fetch(`${getStudioUrl()}/api/avatars/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": getStudioToken() },
        body: JSON.stringify({ session_id: payload.sessionId, name: payload.name, role: payload.role }),
      });
      if (!resp.ok) {
        const b = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${b.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("generate-avatar", async (_event, payload: { description: string }) => {
    try {
      const resp = await fetch(`${getStudioUrl()}/api/avatars/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": getStudioToken() },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const b = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${b.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("list-groups", async () => {
    try {
      const resp = await fetch(`${getStudioUrl()}/api/groups`, {
        headers: { "x-agx-desktop-token": getStudioToken() },
      });
      if (!resp.ok) return { ok: false, groups: [] };
      return await resp.json();
    } catch {
      return { ok: false, groups: [] };
    }
  });

  ipcMain.handle("create-group", async (_event, payload: { name: string; avatar_ids: string[]; routing?: string }) => {
    try {
      const resp = await fetch(`${getStudioUrl()}/api/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": getStudioToken() },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const b = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${b.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("update-group", async (_event, payload: { id: string; name?: string; avatar_ids?: string[]; routing?: string }) => {
    const { id, ...body } = payload;
    try {
      const resp = await fetch(`${getStudioUrl()}/api/groups/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": getStudioToken() },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const b = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${b.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("delete-group", async (_event, id: string) => {
    try {
      const resp = await fetch(`${getStudioUrl()}/api/groups/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "x-agx-desktop-token": getStudioToken() },
      });
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("load-email-config", async () => {
    const cfg = loadAgxConfig();
    return { ok: true, config: loadEmailConfigFromAgx(cfg) };
  });

  ipcMain.handle("load-computer-use-config", async () => {
    const cfg = loadAgxConfig();
    return { ok: true, config: { enabled: loadComputerUseEnabled(cfg) } };
  });

  ipcMain.handle("load-trinity-config", async () => {
    const cfg = loadAgxConfig();
    return { ok: true, config: loadTrinityConfig(cfg) };
  });

  ipcMain.handle("save-computer-use-config", async (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") return { ok: false, error: "invalid payload: object required" };
    const p = payload as { enabled?: unknown };
    let enabled: boolean;
    try {
      enabled = parseBooleanStrict(p.enabled, "enabled");
    } catch (err) {
      return { ok: false, error: String(err) };
    }
    try {
      const cfg = loadAgxConfig();
      const prevRaw = cfg.computer_use;
      const prev =
        prevRaw && typeof prevRaw === "object" && !Array.isArray(prevRaw)
          ? { ...(prevRaw as Record<string, unknown>) }
          : {};
      prev.enabled = enabled;
      cfg.computer_use = prev;
      saveAgxConfig(cfg);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[save-computer-use-config]", err);
      return { ok: false, error: msg || "config_write_failed" };
    }
  });

  ipcMain.handle("save-trinity-config", async (_event, payload: unknown) => {
    const checked = validateTrinityConfigPayload(payload);
    if (!checked.ok) return { ok: false, error: checked.error };
    try {
      const cfg = loadAgxConfig();
      const root = cfg as Record<string, unknown>;
      root.agent_harness_trinity = { ...checked.config };
      saveAgxConfig(cfg);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("load-automation-config", async () => {
    const cfg = loadAgxConfig();
    return { ok: true, config: loadAutomationConfigFromAgx(cfg) };
  });

  ipcMain.handle("save-automation-config", async (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") return { ok: false, error: "invalid payload: object required" };
    const p = payload as { prevent_sleep?: unknown };
    let preventSleep: boolean;
    try {
      preventSleep = parseBooleanStrict(p.prevent_sleep, "prevent_sleep");
    } catch (err) {
      return { ok: false, error: String(err) };
    }
    try {
      const cfg = loadAgxConfig();
      const root = cfg as Record<string, unknown>;
      const prev = root.automation;
      const merged =
        prev && typeof prev === "object" && !Array.isArray(prev)
          ? { ...(prev as Record<string, unknown>) }
          : {};
      merged.prevent_sleep = preventSleep;
      root.automation = merged;
      saveAgxConfig(cfg);
      applyPreventSleepFromConfig(cfg);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Automation Tasks CRUD ──

  ipcMain.handle("confirm-dialog", async (_event, payload: unknown) => {
    const p = (payload && typeof payload === "object")
      ? (payload as {
          title?: unknown;
          message?: unknown;
          detail?: unknown;
          confirmText?: unknown;
          cancelText?: unknown;
          destructive?: unknown;
        })
      : {};
    const title = String(p.title ?? "").trim() || "确认操作";
    const message = String(p.message ?? "").trim() || "请确认是否继续";
    const detail = String(p.detail ?? "").trim();
    const confirmText = String(p.confirmText ?? "").trim() || "确认";
    const cancelText = String(p.cancelText ?? "").trim() || "取消";
    const destructive = Boolean(p.destructive);
    try {
      const focused = BrowserWindow.getFocusedWindow() ?? mainWindow ?? null;
      const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, "assets", "icon.png")
        : path.resolve(process.cwd(), "assets", "icon.png");
      // Destructive: use OS warning style (yellow triangle + exclamation on Windows/Linux; NSAlert
      // warning on macOS). Do not pass app icon — custom SVG rasterization often fails and falls
      // back to the app logo.
      const options: Electron.MessageBoxOptions = {
        type: destructive ? "warning" : "question",
        title,
        message,
        detail: detail || undefined,
        buttons: [cancelText, confirmText],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      };
      if (!destructive && fs.existsSync(iconPath)) {
        options.icon = nativeImage.createFromPath(iconPath);
      }
      const { response } = focused
        ? await dialog.showMessageBox(focused, options)
        : await dialog.showMessageBox(options);
      return { ok: true, confirmed: response === 1 };
    } catch (err) {
      return { ok: false, confirmed: false, error: String(err) };
    }
  });

  ipcMain.handle("load-automation-tasks", async () => {
    try {
      return { ok: true, tasks: loadAutomationTasks() };
    } catch (err) {
      return { ok: false, error: String(err), tasks: [] };
    }
  });

  ipcMain.handle("save-automation-task", async (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") return { ok: false, error: "invalid payload" };
    const task = payload as AutomationTaskData;
    const id = String(task.id ?? "").trim();
    const name = String(task.name ?? "").trim();
    if (!id || !name) return { ok: false, error: "task must have id and name" };
    task.id = id;
    task.name = name;
    const wsTrim = String(task.workspace ?? "").trim();
    // 未指定 workspace → 独占目录 crontask/<id>；指定 → 用户目录。执行时 task.workspace 会挂到会话 taskspace。
    if (!wsTrim) {
      const dir = defaultAutomationCrontaskPath(id);
      task.workspace = dir;
      try {
        fs.mkdirSync(AUTOMATION_CRONTASK_DIR, { recursive: true });
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    } else {
      try {
        fs.mkdirSync(wsTrim, { recursive: true });
      } catch {
        /* best-effort */
      }
    }
    try {
      const tasks = loadAutomationTasks();
      const idx = tasks.findIndex((t) => t.id === task.id);
      if (idx >= 0) {
        tasks[idx] = task;
      } else {
        tasks.unshift(task);
      }
      saveAutomationTasks(tasks);
      automationScheduler.reload();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("delete-automation-task", async (_event, payload: unknown) => {
    let taskId = "";
    let removeCrontaskDir = false;
    if (typeof payload === "string") {
      taskId = payload.trim();
    } else if (payload && typeof payload === "object") {
      const p = payload as { taskId?: unknown; removeCrontaskDir?: unknown };
      taskId = String(p.taskId ?? "").trim();
      removeCrontaskDir = Boolean(p.removeCrontaskDir);
    }
    if (!taskId) return { ok: false, error: "taskId required" };
    try {
      if (removeCrontaskDir) {
        const crontaskPath = path.resolve(defaultAutomationCrontaskPath(taskId));
        const root = path.resolve(AUTOMATION_CRONTASK_DIR);
        if (fs.existsSync(crontaskPath) && crontaskPath !== root && crontaskPath.startsWith(root + path.sep)) {
          fs.rmSync(crontaskPath, { recursive: true, force: true });
        }
      }
      const tasks = loadAutomationTasks().filter((t) => t.id !== taskId);
      saveAutomationTasks(tasks);
      automationScheduler.reload();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("automation-crontask-dir-info", async (_event, taskId: unknown) => {
    const id = typeof taskId === "string" ? taskId.trim() : "";
    if (!id) return { ok: false, path: "", exists: false };
    const p = defaultAutomationCrontaskPath(id);
    try {
      return { ok: true, path: p, exists: fs.existsSync(p) };
    } catch {
      return { ok: true, path: p, exists: false };
    }
  });

  ipcMain.handle("cancel-automation-task-run", async (_event, taskId: unknown) => {
    const id = typeof taskId === "string" ? taskId.trim() : "";
    if (!id) return { ok: false, error: "taskId required" };
    automationRunUserCancelled.add(id);
    const c = automationRunControllers.get(id);
    if (c) {
      try {
        c.abort();
      } catch {
        /* ignore */
      }
    }
    return { ok: true };
  });

  ipcMain.handle("run-automation-task-now", async (_event, payload: unknown) => {
    let taskId = "";
    let sessionOverride = "";
    if (typeof payload === "string") {
      taskId = payload.trim();
    } else if (payload && typeof payload === "object") {
      const p = payload as { taskId?: unknown; sessionId?: unknown };
      taskId = String(p.taskId ?? "").trim();
      sessionOverride = String(p.sessionId ?? "").trim();
    }
    if (!taskId) return { ok: false, error: "taskId 无效" };
    try {
      const tasks = loadAutomationTasks();
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return { ok: false, error: "未找到任务" };

      emitAutomationTaskProgress({
        taskId: task.id,
        taskName: task.name,
        trigger: "manual",
        phase: "running",
        sessionId: resolveAutomationSessionId(task, sessionOverride) || undefined,
        ts: Date.now(),
      });
      const result = await runAutomationTaskHttp(task, {
        sessionIdOverride: sessionOverride || undefined,
      });

      task.lastRunAt = new Date().toISOString();
      task.lastRunStatus = result.ok ? "success" : "error";
      if (result.ok) {
        delete task.lastRunError;
      } else {
        task.lastRunError = sanitizeAutomationRunError(result.error) ?? "执行失败";
      }
      saveAutomationTasks(tasks);
      emitAutomationTaskProgress({
        taskId: task.id,
        taskName: task.name,
        trigger: "manual",
        phase: result.ok ? "success" : "error",
        sessionId: result.sessionId || resolveAutomationSessionId(task, sessionOverride) || undefined,
        message: result.error,
        ts: Date.now(),
      });

      return {
        ok: result.ok,
        error: result.ok ? undefined : (result.error ?? "执行失败"),
      };
    } catch (err) {
      const tasks = loadAutomationTasks();
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        task.lastRunStatus = "error";
        task.lastRunAt = new Date().toISOString();
        task.lastRunError = sanitizeAutomationRunError(err) ?? "执行异常";
        saveAutomationTasks(tasks);
      }
      const sidFromTask = task ? resolveAutomationSessionId(task, sessionOverride) : "";
      emitAutomationTaskProgress({
        taskId: taskId,
        taskName: task?.name ?? "自动化任务",
        trigger: "manual",
        phase: "error",
        sessionId: sidFromTask || undefined,
        message: String(err),
        ts: Date.now(),
      });
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("load-skill-install-policy", async () => {
    const cfg = loadAgxConfig();
    return { ok: true, config: loadSkillInstallPolicyFromAgx(cfg) };
  });

  ipcMain.handle("save-skill-install-policy", async (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") return { ok: false, error: "invalid payload: object required" };
    const p = payload as { non_high_risk_auto_install?: unknown };
    let flag: boolean;
    try {
      flag = parseBooleanStrict(p.non_high_risk_auto_install, "non_high_risk_auto_install");
    } catch (err) {
      return { ok: false, error: String(err) };
    }
    try {
      const cfg = loadAgxConfig();
      const root = cfg as Record<string, unknown>;
      const prev = root.skills;
      const merged =
        prev && typeof prev === "object" && !Array.isArray(prev)
          ? { ...(prev as Record<string, unknown>) }
          : {};
      merged.non_high_risk_auto_install = flag;
      root.skills = merged;
      saveAgxConfig(cfg);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("save-email-config", async (_event, payload: unknown) => {
    const checked = validateEmailConfigPayload(payload);
    if (!checked.ok) return { ok: false, error: checked.error };
    try {
      const cfg = loadAgxConfig();
      const nextNotifications = { ...(cfg.notifications ?? {}) };
      nextNotifications.email = { ...checked.config };
      cfg.notifications = nextNotifications;
      saveAgxConfig(cfg);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: "config_write_failed" };
    }
  });

  ipcMain.handle("test-email-config", async (_event, payload: { config?: unknown; toEmail?: string }) => {
    const checked = validateEmailConfigPayload(payload?.config ?? {});
    if (!checked.ok) return { ok: false, error: checked.error };
    const toEmail = String(payload?.toEmail ?? checked.config.default_to_email).trim() || checked.config.default_to_email;
    try {
      const resp = await fetch(`${getStudioUrl()}/api/test-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agx-desktop-token": getStudioToken(),
        },
        body: JSON.stringify({
          config: checked.config,
          to_email: toEmail,
        }),
      });
      if (!resp.ok) {
        return { ok: false, error: `HTTP ${resp.status}: email_test_failed` };
      }
      return await resp.json();
    } catch {
      return { ok: false, error: "email_test_request_failed" };
    }
  });

  ipcMain.handle("load-mcp-status", async (_event, sessionId: string) => {
    const sid = String(sessionId || "").trim();
    if (!sid) return { ok: false, error: "missing sessionId", servers: [] };
    try {
      const resp = await fetch(
        `${getStudioUrl()}/api/mcp/servers?session_id=${encodeURIComponent(sid)}`,
        {
          headers: { "x-agx-desktop-token": getStudioToken() },
        }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}`, servers: [] };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err), servers: [] };
    }
  });

  ipcMain.handle("import-mcp-config", async (_event, payload: { sessionId: string; sourcePath: string }) => {
    const sid = String(payload?.sessionId || "").trim();
    const sourcePath = String(payload?.sourcePath || "").trim();
    if (!sid || !sourcePath) return { ok: false, error: "sessionId and sourcePath are required" };
    try {
      const resp = await fetch(`${getStudioUrl()}/api/mcp/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agx-desktop-token": getStudioToken(),
        },
        body: JSON.stringify({ session_id: sid, source_path: sourcePath }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("connect-mcp", async (_event, payload: { sessionId: string; name: string }) => {
    const sid = String(payload?.sessionId || "").trim();
    const name = String(payload?.name || "").trim();
    if (!sid || !name) return { ok: false, error: "sessionId and name are required" };
    try {
      const resp = await fetch(`${getStudioUrl()}/api/mcp/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agx-desktop-token": getStudioToken(),
        },
        body: JSON.stringify({ session_id: sid, name }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("get-mcp-settings", async () => {
    try {
      const resp = await fetch(`${getStudioUrl()}/api/mcp/settings`, {
        headers: { "x-agx-desktop-token": getStudioToken() },
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("put-mcp-settings", async (_event, payload: { extraSearchPaths: string[] }) => {
    const paths = Array.isArray(payload?.extraSearchPaths) ? payload.extraSearchPaths : [];
    try {
      const resp = await fetch(`${getStudioUrl()}/api/mcp/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-agx-desktop-token": getStudioToken(),
        },
        body: JSON.stringify({ extra_search_paths: paths }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("get-skill-settings", async () => {
    try {
      const resp = await fetch(`${getStudioUrl()}/api/skills/settings`, {
        headers: { "x-agx-desktop-token": getStudioToken() },
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(
    "put-skill-settings",
    async (
      _event,
      payload: {
        presetPaths: Array<{ id: string; enabled: boolean }>;
        customPaths: string[];
        preferredSources?: Record<string, string>;
        disabledSkills?: string[];
      },
    ) => {
      const preset_paths = Array.isArray(payload?.presetPaths) ? payload.presetPaths : [];
      const custom_paths = Array.isArray(payload?.customPaths) ? payload.customPaths : [];
      const preferred_sources =
        payload?.preferredSources && typeof payload.preferredSources === "object"
          ? payload.preferredSources
          : {};
      const body: Record<string, unknown> = { preset_paths, custom_paths, preferred_sources };
      if (Array.isArray(payload?.disabledSkills)) {
        body.disabled_skills = payload.disabledSkills;
      }
      try {
        const resp = await fetch(`${getStudioUrl()}/api/skills/settings`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-agx-desktop-token": getStudioToken(),
          },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
        }
        return await resp.json();
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle("disconnect-mcp", async (_event, payload: { sessionId: string; name: string }) => {
    const sid = String(payload?.sessionId || "").trim();
    const name = String(payload?.name || "").trim();
    if (!sid || !name) return { ok: false, error: "sessionId and name are required" };
    try {
      const resp = await fetch(`${getStudioUrl()}/api/mcp/disconnect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agx-desktop-token": getStudioToken(),
        },
        body: JSON.stringify({ session_id: sid, name }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("save-user-mode", async (_event, mode: "pro" | "lite") => {
    const cfg = loadAgxConfig();
    cfg.user_mode = mode;
    saveAgxConfig(cfg);
    return { ok: true };
  });

  ipcMain.handle("save-onboarding-completed", async (_event, completed: boolean) => {
    const cfg = loadAgxConfig();
    cfg.onboarding_completed = completed;
    saveAgxConfig(cfg);
    return { ok: true };
  });

  ipcMain.handle("save-confirm-strategy", async (_event, strategy: "manual" | "semi-auto" | "auto") => {
    const cfg = loadAgxConfig();
    cfg.confirm_strategy = strategy;
    saveAgxConfig(cfg);
    return { ok: true };
  });

  ipcMain.handle("save-provider", async (_event, payload: {
    name: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    models?: string[];
    enabled?: boolean;
    dropParams?: boolean;
  }) => {
    const cfg = loadAgxConfig();
    if (!cfg.providers) cfg.providers = {};
    const prev = cfg.providers[payload.name] ?? {};
    const next: ProviderConfig = {
      ...prev,
      api_key: payload.apiKey ?? prev.api_key,
      base_url: payload.baseUrl ?? prev.base_url,
      model: payload.model ?? prev.model,
      models: payload.models ?? prev.models,
    };
    if (payload.enabled === true || payload.enabled === false) {
      next.enabled = payload.enabled;
    } else if (typeof next.enabled !== "boolean") {
      next.enabled = true;
    }
    if (payload.dropParams === true) {
      next.drop_params = true;
    } else if (payload.dropParams === false) {
      delete next.drop_params;
    }
    cfg.providers[payload.name] = next;
    saveAgxConfig(cfg);
    return { ok: true };
  });

  ipcMain.handle("set-default-provider", async (_event, name: string) => {
    const cfg = loadAgxConfig();
    cfg.default_provider = name;
    saveAgxConfig(cfg);
    return { ok: true };
  });

  ipcMain.handle("delete-provider", async (_event, name: string) => {
    const cfg = loadAgxConfig();
    if (cfg.providers) delete cfg.providers[name];
    if (cfg.default_provider === name) cfg.default_provider = Object.keys(cfg.providers ?? {})[0] ?? "";
    saveAgxConfig(cfg);
    return { ok: true };
  });

  ipcMain.handle("validate-key", async (_event, payload: {
    provider: string;
    apiKey: string;
    baseUrl?: string;
  }) => {
    const base = (payload.baseUrl || KNOWN_BASE_URLS[payload.provider] || "").replace(/\/+$/, "");
    if (!base) return { ok: false, error: "未知 provider，请填写 API 地址" };
    const isMinimax = payload.provider === "minimax";
    const url = isMinimax ? `${base}/chat/completions` : `${base}/models`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const resp = isMinimax
        ? await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${payload.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "MiniMax-M2.5",
              messages: [{ role: "user", content: "hi" }],
              max_tokens: 1,
            }),
            signal: controller.signal,
          })
        : await fetch(url, {
            headers: { Authorization: `Bearer ${payload.apiKey}` },
            signal: controller.signal,
          });
      clearTimeout(timer);
      if (resp.ok) return { ok: true, status: resp.status };
      const body = await resp.text().catch(() => "");
      return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 200)}` };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("fetch-models", async (_event, payload: {
    provider: string;
    apiKey: string;
    baseUrl?: string;
  }) => {
    const base = (payload.baseUrl || KNOWN_BASE_URLS[payload.provider] || "").replace(/\/+$/, "");
    if (!base) return { ok: false, models: [], error: "未知 API 地址" };
    const url = `${base}/models`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${payload.apiKey}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) {
        const fallback = PROVIDER_FALLBACK_MODELS[payload.provider];
        if (resp.status === 404 && Array.isArray(fallback) && fallback.length > 0) {
          return { ok: true, models: fallback };
        }
        return { ok: false, models: [], error: `HTTP ${resp.status}` };
      }
      const data = await resp.json() as { data?: Array<{ id: string }> };
      const models = (data.data ?? []).map((m) => m.id).sort();
      return { ok: true, models };
    } catch (err) {
      return { ok: false, models: [], error: String(err) };
    }
  });

  ipcMain.handle("health-check-model", async (_event, payload: {
    provider: string;
    apiKey: string;
    baseUrl?: string;
    model: string;
  }) => {
    const base = (payload.baseUrl || KNOWN_BASE_URLS[payload.provider] || "").replace(/\/+$/, "");
    if (!base) return { ok: false, error: "未知 API 地址" };
    const url = `${base}/chat/completions`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${payload.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: payload.model,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (resp.ok) return { ok: true, latencyHint: "healthy" };
      const body = await resp.text().catch(() => "");
      return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 200)}` };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Legacy compatibility
  ipcMain.handle("save-config", async (_event, payload: { provider?: string; model?: string; apiKey?: string; activeProvider?: string; activeModel?: string }) => {
    const cfg = loadAgxConfig();
    const name = payload.provider || cfg.default_provider || "openai";
    if (!cfg.providers) cfg.providers = {};
    const prev = cfg.providers[name] ?? {};
    cfg.providers[name] = { ...prev };
    if (payload.apiKey) cfg.providers[name].api_key = payload.apiKey;
    if (payload.model) cfg.providers[name].model = payload.model;
    cfg.default_provider = name;
    if (payload.activeProvider) cfg.active_provider = payload.activeProvider;
    if (payload.activeModel) cfg.active_model = payload.activeModel;
    saveAgxConfig(cfg);
    return { ok: true, path: CONFIG_PATH };
  });

  ipcMain.handle("native-say", async (_event, text: string) => {
    if (process.platform !== "darwin") {
      return { ok: false, reason: "not-macos" };
    }
    await new Promise<void>((resolve) => {
      execFile("say", ["-v", "Ting-Ting", text], () => resolve());
    });
    return { ok: true };
  });

  ipcMain.handle("load-meta-soul", async () => {
    try {
      return { ok: true, content: loadSoulFile(META_SOUL_PATH) };
    } catch (err) {
      return { ok: false, content: "", error: String(err) };
    }
  });

  ipcMain.handle("save-meta-soul", async (_event, payload: { content?: string }) => {
    try {
      saveSoulFile(META_SOUL_PATH, String(payload?.content ?? ""));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("load-avatar-soul", async (_event, payload: { avatarId?: string }) => {
    try {
      const soulPath = resolveAvatarSoulPath(String(payload?.avatarId ?? ""));
      return { ok: true, content: loadSoulFile(soulPath) };
    } catch (err) {
      return { ok: false, content: "", error: String(err) };
    }
  });

  ipcMain.handle("save-avatar-soul", async (_event, payload: { avatarId?: string; content?: string }) => {
    try {
      const soulPath = resolveAvatarSoulPath(String(payload?.avatarId ?? ""));
      saveSoulFile(soulPath, String(payload?.content ?? ""));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("load-skills", async () => {
    const studioUrl = getStudioUrl();
    try {
      const resp = await fetch(`${studioUrl}/api/skills`, {
        headers: { "x-agx-desktop-token": getStudioToken() },
      });
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err), items: [], count: 0 };
    }
  });

  ipcMain.handle("load-skill-detail", async (_event, args: { name: string }) => {
    const studioUrl = getStudioUrl();
    try {
      const resp = await fetch(`${studioUrl}/api/skills/${encodeURIComponent(args.name)}`, {
        headers: { "x-agx-desktop-token": getStudioToken() },
      });
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("refresh-skills", async () => {
    const studioUrl = getStudioUrl();
    try {
      const resp = await fetch(`${studioUrl}/api/skills/refresh`, {
        method: "POST",
        headers: { "x-agx-desktop-token": getStudioToken() },
      });
      const data = await resp.json();
      if (data?.ok) emitSkillsChanged();
      return data;
    } catch (err) {
      return { ok: false, error: String(err), count: 0 };
    }
  });

  ipcMain.handle("load-bundles", async () => {
    const studioUrl = getStudioUrl();
    try {
      const resp = await fetch(`${studioUrl}/api/bundles`, {
        headers: { "x-agx-desktop-token": getStudioToken() },
      });
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err), items: [], count: 0 };
    }
  });

  ipcMain.handle(
    "install-bundle",
    async (
      _event,
      args: {
        sourcePath: string;
        acknowledgeHighRisk?: boolean;
        confirmNonHighRisk?: boolean;
      }
    ) => {
      const studioUrl = getStudioUrl();
      try {
        const resp = await fetch(`${studioUrl}/api/bundles/install`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-agx-desktop-token": getStudioToken() },
          body: JSON.stringify({
            source_path: args.sourcePath,
            acknowledge_high_risk: Boolean(args.acknowledgeHighRisk),
            confirm_non_high_risk: Boolean(args.confirmNonHighRisk),
          }),
        });
        return await resp.json();
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }
  );

  ipcMain.handle("install-bundle-preview", async (_event, args: { sourcePath: string }) => {
    const studioUrl = getStudioUrl();
    try {
      const resp = await fetch(`${studioUrl}/api/bundles/install-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": getStudioToken() },
        body: JSON.stringify({ source_path: args.sourcePath }),
      });
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("uninstall-bundle", async (_event, args: { name: string }) => {
    const studioUrl = getStudioUrl();
    try {
      const resp = await fetch(`${studioUrl}/api/bundles/${encodeURIComponent(args.name)}`, {
        method: "DELETE",
        headers: { "x-agx-desktop-token": getStudioToken() },
      });
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("search-registry", async (_event, args: { q: string }) => {
    const studioUrl = getStudioUrl();
    try {
      const params = new URLSearchParams({ q: args.q || "" });
      const resp = await fetch(`${studioUrl}/api/registry/search?${params.toString()}`, {
        headers: { "x-agx-desktop-token": getStudioToken() },
      });
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err), items: [], count: 0 };
    }
  });

  ipcMain.handle("search-skillhub", async (_event, args: { q: string }) => {
    const studioUrl = getStudioUrl();
    try {
      const params = new URLSearchParams({ q: args.q || "" });
      const resp = await fetch(`${studioUrl}/api/registry/skillhub/search?${params.toString()}`, {
        headers: { "x-agx-desktop-token": getStudioToken() },
      });
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err), items: [], count: 0 };
    }
  });

  ipcMain.handle("load-local-image-data-url", async (_event, inputPath: string) => {
    try {
      const raw = String(inputPath || "").trim();
      if (!raw) return { ok: false, error: "empty path" };
      const normalized = raw.startsWith("file://") ? decodeURIComponent(raw.replace(/^file:\/\//, "")) : raw;
      if (!fs.existsSync(normalized)) {
        return { ok: false, error: "file not found" };
      }
      const buf = await fs.promises.readFile(normalized);
      const ext = path.extname(normalized).toLowerCase();
      const mime =
        ext === ".png"
          ? "image/png"
          : ext === ".jpg" || ext === ".jpeg"
            ? "image/jpeg"
            : ext === ".gif"
              ? "image/gif"
              : ext === ".webp"
                ? "image/webp"
                : "application/octet-stream";
      return { ok: true, dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(
    "install-from-registry",
    async (
      _event,
      args: {
        source: string;
        name: string;
        acknowledgeHighRisk?: boolean;
        confirmNonHighRisk?: boolean;
      }
    ) => {
      const studioUrl = getStudioUrl();
      try {
        const resp = await fetch(`${studioUrl}/api/registry/install`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-agx-desktop-token": getStudioToken() },
          body: JSON.stringify({
            source: args.source,
            name: args.name,
            acknowledge_high_risk: Boolean(args.acknowledgeHighRisk),
            confirm_non_high_risk: Boolean(args.confirmNonHighRisk),
          }),
        });
        return await resp.json();
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }
  );

  ipcMain.handle("install-from-registry-preview", async (_event, args: { source: string; name: string }) => {
    const studioUrl = getStudioUrl();
    try {
      const resp = await fetch(`${studioUrl}/api/registry/install-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": getStudioToken() },
        body: JSON.stringify({ source: args.source, name: args.name }),
      });
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(
    "terminal-spawn",
    async (event, payload: { id: string; cwd: string; cols?: number; rows?: number }) => {
      const ptyMod = requireNodePty();
      if (!ptyMod) return { ok: false as const, error: "node-pty unavailable" };
      // Fall back to home dir if the requested cwd no longer exists
      const rawCwd = (payload.cwd || "").trim();
      const cwd = (rawCwd && fs.existsSync(rawCwd)) ? rawCwd : os.homedir();
      const id = (payload.id || "").trim();
      if (!id) return { ok: false as const, error: "missing id" };
      if (terminalSessions.has(id)) {
        killTerminalSession(id);
      }
      const cols = Math.max(40, Math.min(300, Number(payload.cols) || 80));
      const rows = Math.max(10, Math.min(200, Number(payload.rows) || 24));
      const wc = event.sender;

      let shellPath: string;
      let shellArgs: string[];
      if (process.platform === "win32") {
        shellPath = "powershell.exe";
        shellArgs = ["-NoLogo"];
      } else {
        // Prefer the user's login shell; fall back to zsh then bash.
        // Use -i (interactive) so PS1 / rcfiles load, but avoid -l (login)
        // which re-runs /etc/zprofile and can clobber PATH or call `exit`.
        const candidate = process.env.SHELL || "";
        shellPath = (candidate && fs.existsSync(candidate)) ? candidate
          : (fs.existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash");
        shellArgs = ["-i"];
      }

      try {
        const ptyProcess = ptyMod.spawn(shellPath, shellArgs, {
          name: "xterm-256color",
          cols,
          rows,
          cwd,
          env: (() => {
            // Prevent any rc-file from reading a stale PS1/ENV that calls exit
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { BASH_ENV: _ignored, ...rest } = process.env;
            return { ...rest, TERM: "xterm-256color" } as Record<string, string>;
          })(),
        });
        terminalSessions.set(id, { kind: "pty", pty: ptyProcess, wc });
        ptyProcess.onData((data) => {
          if (!wc.isDestroyed()) {
            wc.send("terminal-data", { id, data });
          }
        });
        ptyProcess.onExit(() => {
          terminalSessions.delete(id);
          if (!wc.isDestroyed()) {
            wc.send("terminal-exit", { id });
          }
        });
        return { ok: true as const, id };
      } catch (err) {
        return { ok: false as const, error: String(err) };
      }
    }
  );

  ipcMain.handle("terminal-write", async (_event, payload: { id: string; data: string }) => {
    const sess = terminalSessions.get(payload.id);
    if (!sess) return { ok: false };
    if (sess.kind === "bridge") {
      const url = `${sess.baseUrl}/v1/sessions/${encodeURIComponent(sess.sessionId)}/write`;
      const ok = await ccBridgeHttpPostJson(url, sess.token, { data: payload.data });
      return { ok };
    }
    try {
      sess.pty.write(payload.data);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle("terminal-write-by-tab", async (_event, payload: { tabId: string; data: string }) => {
    const tabId = (payload.tabId || "").trim();
    if (!tabId) return { ok: false };
    const prefix = `${tabId}:`;
    for (const [id, sess] of terminalSessions.entries()) {
      if (!id.startsWith(prefix)) continue;
      if (sess.kind === "bridge") {
        const url = `${sess.baseUrl}/v1/sessions/${encodeURIComponent(sess.sessionId)}/write`;
        const ok = await ccBridgeHttpPostJson(url, sess.token, { data: payload.data });
        return { ok, id };
      }
      try {
        sess.pty.write(payload.data);
        return { ok: true, id };
      } catch {
        return { ok: false };
      }
    }
    return { ok: false };
  });

  ipcMain.handle("terminal-resize", async (_event, payload: { id: string; cols: number; rows: number }) => {
    const sess = terminalSessions.get(payload.id);
    if (!sess) return { ok: false };
    const cols = Math.max(2, Math.min(300, Math.floor(payload.cols)));
    const rows = Math.max(2, Math.min(200, Math.floor(payload.rows)));
    if (sess.kind === "bridge") {
      const url = `${sess.baseUrl}/v1/sessions/${encodeURIComponent(sess.sessionId)}/resize`;
      const ok = await ccBridgeHttpPostJson(url, sess.token, { cols, rows });
      return { ok };
    }
    try {
      sess.pty.resize(cols, rows);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle(
    "terminal-bridge-attach",
    async (
      event,
      payload: {
        id: string;
        sessionId: string;
        baseUrl: string;
        token: string;
        cols?: number;
        rows?: number;
      }
    ) => {
      const id = (payload.id || "").trim();
      const sessionId = (payload.sessionId || "").trim();
      const baseUrl = (payload.baseUrl || "").trim().replace(/\/$/, "");
      const token = (payload.token || "").trim();
      if (!id || !sessionId || !baseUrl || !token) {
        return { ok: false as const, error: "missing id, sessionId, baseUrl, or token" };
      }
      const wc = event.sender;
      killTerminalSession(id);
      const cols = Math.max(40, Math.min(300, Number(payload.cols) || 80));
      const rows = Math.max(10, Math.min(200, Number(payload.rows) || 24));
      const abort = new AbortController();
      const streamUrl = `${baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/stream`;
      const resizeUrl = `${baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/resize`;

      terminalSessions.set(id, { kind: "bridge", wc, baseUrl, token, sessionId, abort });

      void (async () => {
        try {
          await ccBridgeHttpPostJson(resizeUrl, token, { cols, rows }, abort.signal).catch(() => {
            /* best-effort */
          });
          const utf8Decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
          if (ccBridgeUrlIsLoopback(streamUrl)) {
            const streamOk = await ccBridgeHttpGetStreamLoopback(streamUrl, token, abort.signal, (chunk) => {
              if (wc.isDestroyed()) return;
              const s = utf8Decoder.decode(chunk, { stream: true });
              if (s) {
                wc.send("terminal-data", { id, data: s });
              }
            });
            if (!streamOk) {
              return;
            }
            const tail = utf8Decoder.decode();
            if (tail && !wc.isDestroyed()) {
              wc.send("terminal-data", { id, data: tail });
            }
          } else {
            const resp = await fetch(streamUrl, {
              headers: { Authorization: `Bearer ${token}` },
              signal: abort.signal,
            });
            if (!resp.ok || !resp.body) {
              return;
            }
            const reader = resp.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                const tailRemote = utf8Decoder.decode();
                if (tailRemote && !wc.isDestroyed()) {
                  wc.send("terminal-data", { id, data: tailRemote });
                }
                break;
              }
              if (value && value.length > 0 && !wc.isDestroyed()) {
                const s = utf8Decoder.decode(value, { stream: true });
                if (s) {
                  wc.send("terminal-data", { id, data: s });
                }
              }
            }
          }
        } catch (err) {
          const name = err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name) : "";
          if (name !== "AbortError") {
            console.error("[terminal-bridge-attach] stream error:", err);
          }
        } finally {
          terminalSessions.delete(id);
          if (!wc.isDestroyed()) {
            wc.send("terminal-exit", { id });
          }
        }
      })();

      return { ok: true as const, id };
    }
  );

  ipcMain.handle("terminal-kill", (_event, id: string) => {
    killTerminalSession((id || "").trim());
    return { ok: true };
  });
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.setName("Machi");

  app.whenReady().then(async () => {
    try {
      Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate()));
      if (process.platform === "darwin") {
        const iconPath = app.isPackaged
          ? path.join(process.resourcesPath, "assets", "icon.png")
          : path.resolve(process.cwd(), "assets", "icon.png");
        if (fs.existsSync(iconPath)) {
          app.dock.setIcon(iconPath);
        }
      }

      // Register basic IPC handlers immediately so the renderer never hits
      // "No handler registered" errors during the agx serve startup delay.
      registerEarlyIpc();

      remoteConfig = loadRemoteConfig();

      if (remoteConfig) {
        const ok = await pingRemoteServer(remoteConfig);
        if (!ok) {
          const { response } = await dialog.showMessageBox({
            type: "warning",
            title: "无法连接远程服务器",
            message: `无法连接到 ${remoteConfig.url}`,
            detail: [
              "请检查：",
              "1. 云主机上 agx serve 是否已启动",
              "2. URL 和端口是否正确",
              "3. 防火墙是否放行",
              "4. Token 是否匹配",
            ].join("\n"),
            buttons: ["重试", "退出"],
            defaultId: 0,
            cancelId: 1,
          });
          if (response === 0) {
            const retryOk = await pingRemoteServer(remoteConfig);
            if (!retryOk) {
              app.quit();
              return;
            }
          } else {
            app.quit();
            return;
          }
        }
      } else {
        const bundledPath = resolveBundledBackend();
        if (!bundledPath) {
          const agxOk = await checkAgxCli();
          if (!agxOk) {
            const installDocsUrl = "https://www.agxbuilder.com/docs/getting-started/installation";
            const { response } = await dialog.showMessageBox({
              type: "warning",
              title: "缺少 agx 命令行工具",
              message: "Machi 需要本地 agx CLI 或内嵌后端才能启动",
              detail: [
                "当前为开发/未打包构建，且未检测到 agx 命令。可选：",
                "",
                "1) 安装 agx（终端）：",
                "   pip install agenticx",
                "   或见官方安装脚本说明",
                "",
                "2) 在「设置」中启用远程服务器模式，连接已部署的 agx serve",
                "",
                "3) 发布版 DMG：使用 packaging/build_dmg.sh 构建后会内嵌 agx-server",
              ].join("\n"),
              buttons: ["查看安装说明", "退出"],
              defaultId: 0,
              cancelId: 1,
            });
            if (response === 0) {
              void shell.openExternal(installDocsUrl);
            }
            app.quit();
            return;
          }
        }

        await startStudioServe();
        await waitServeReady();
        startFeishuProcess();
        void startWechatSidecar();
      }

      registerIpc();
      applyPreventSleepFromConfig(loadAgxConfig());
      automationScheduler.start();
      createWindow();
      startSkillsDirWatcher();
      createTray();
    } catch (error) {
      await dialog.showErrorBox(
        "Machi 启动失败",
        remoteConfig
          ? `无法连接远程服务器。\n\n${String(error)}`
          : `无法启动本地服务，请检查 agx 是否可用。\n\n${String(error)}`
      );
      app.quit();
    }
  });

  app.on("activate", () => {
    if (!mainWindow) {
      createWindow();
      return;
    }
    mainWindow.show();
    mainWindow.focus();
  });

  app.on("before-quit", () => {
    isQuitting = true;
    automationScheduler.stop();
    stopSkillsDirWatcher();
    killAllTerminalSessions();
    stopFeishuProcess();
    stopWechatSidecar();
    stopStudioServe();
  });
}
