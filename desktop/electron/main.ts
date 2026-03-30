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
import yaml from "js-yaml";

type ProviderConfig = {
  api_key?: string;
  base_url?: string;
  model?: string;
  models?: string[];
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
let isQuitting = false;
let serveStdoutBuffer = "";
let serveStderrBuffer = "";
let remoteConfig: ResolvedRemoteConfig | null = null;

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

function buildAugmentedPath(): string {
  const home = os.homedir();
  const sep = pathListSeparator();
  const basePath =
    process.env.PATH ?? (process.platform === "win32" ? "" : "/usr/bin:/bin");

  let extraPaths: string[];
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    extraPaths = [
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
 * Windows: `cmd /c` is unnecessary; Node resolves `agx`/`agx.cmd` from PATH.
 */
function spawnAgx(
  args: string[],
  options: { cwd?: string; stdio: ("ignore" | "pipe")[]; env: NodeJS.ProcessEnv }
): ChildProcess {
  return spawn("agx", args, { ...options, shell: false });
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
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch { /* not here */ }
    }
  }
  return null;
}

async function checkAgxCli(): Promise<boolean> {
  const augmentedPath = buildAugmentedPath();

  const binaryPath = findAgxBinaryOnPath(augmentedPath);
  if (!binaryPath) return false;

  return new Promise((resolve) => {
    const proc = spawnAgx(["--version"], {
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

  if (bundledPath) {
    serveProcess = spawnBundledServer(
      bundledPath,
      ["--host", "127.0.0.1", "--port", String(apiPort)],
      { cwd: desktopHome, stdio: ["ignore", "pipe", "pipe"], env }
    );
  } else {
    serveProcess = spawnAgx(
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
    const onError = () => {
      fail("agx serve failed to start");
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
  feishuProcess = spawnAgx(
    ["feishu", "--app-id", lc.app_id, "--app-secret", lc.app_secret],
    { cwd: os.homedir(), stdio: ["ignore", "pipe", "pipe"], env: process.env }
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

type TerminalSession = {
  pty: import("node-pty").IPty;
  wc: Electron.WebContents;
};

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
  try {
    sess.pty.kill();
  } catch {
    // noop
  }
  terminalSessions.delete(id);
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

function createWindow(): void {
  const vibrancyEnabled = process.env.AGX_ENABLE_VIBRANCY === "1";
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
    const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";
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

  ipcMain.handle("get-tools-policy", async () => {
    try {
      const resp = await fetch(`${getStudioUrl()}/api/tools/policy`, {
        headers: { "x-agx-desktop-token": getStudioToken() },
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, tools_enabled: {}, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, tools_enabled: {}, error: String(err) };
    }
  });

  ipcMain.handle("save-tools-policy", async (_event, payload: { tools_enabled?: Record<string, boolean> }) => {
    try {
      const resp = await fetch(`${getStudioUrl()}/api/tools/policy`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-agx-desktop-token": getStudioToken(),
        },
        body: JSON.stringify({ tools_enabled: payload?.tools_enabled ?? {} }),
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
      return await resp.json();
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
      return await resp.json();
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
      return await resp.json();
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
        terminalSessions.set(id, { pty: ptyProcess, wc });
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

  ipcMain.handle("terminal-write", (_event, payload: { id: string; data: string }) => {
    const sess = terminalSessions.get(payload.id);
    if (!sess) return { ok: false };
    try {
      sess.pty.write(payload.data);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle("terminal-resize", (_event, payload: { id: string; cols: number; rows: number }) => {
    const sess = terminalSessions.get(payload.id);
    if (!sess) return { ok: false };
    try {
      sess.pty.resize(
        Math.max(2, Math.min(300, Math.floor(payload.cols))),
        Math.max(2, Math.min(200, Math.floor(payload.rows)))
      );
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

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
      }

      registerIpc();
      applyPreventSleepFromConfig(loadAgxConfig());
      createWindow();
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
    killAllTerminalSessions();
    stopFeishuProcess();
    stopStudioServe();
  });
}
