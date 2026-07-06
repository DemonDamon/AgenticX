import { contextBridge, ipcRenderer, webUtils } from "electron";

function parseArgvFlag(prefix: string, fallback: string): string {
  for (const arg of process.argv) {
    if (arg.startsWith(prefix)) {
      try {
        return decodeURIComponent(arg.slice(prefix.length));
      } catch {
        return arg.slice(prefix.length);
      }
    }
  }
  return fallback;
}

const injectedBackendScope = parseArgvFlag("--agx-backend-scope=", "local");
const injectedConnectionMode =
  parseArgvFlag("--agx-connection-mode=", "local") === "remote" ? "remote" : "local";

/** Live query from main process (argv injection can be stale if window opened early). */
function queryBackendScopeSync(): string {
  try {
    const v = ipcRenderer.sendSync("agx-query-backend-scope") as unknown;
    if (typeof v === "string" && v.trim()) return v.trim();
  } catch {
    // fall through
  }
  return injectedBackendScope;
}

function queryConnectionModeSync(): "local" | "remote" {
  try {
    const v = ipcRenderer.sendSync("agx-query-connection-mode") as unknown;
    if (v === "remote" || v === "local") return v;
  } catch {
    // fall through
  }
  return injectedConnectionMode;
}

async function desktopApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const base = (await ipcRenderer.invoke("get-api-base")) as string;
    const token = (await ipcRenderer.invoke("get-api-auth-token")) as string;
    const resp = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "x-agx-desktop-token": token,
        ...(init?.headers ?? {}),
      },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` } as T;
    }
    return (await resp.json()) as T;
  } catch (error) {
    return { ok: false, error: String(error) } as T;
  }
}

contextBridge.exposeInMainWorld("agenticxDesktop", {
  version: "0.2.5",
  getApiBase: async (): Promise<string> => ipcRenderer.invoke("get-api-base"),
  waitForStudio: async (timeoutMs?: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("wait-for-studio", timeoutMs),
  getApiAuthToken: async (): Promise<string> => ipcRenderer.invoke("get-api-auth-token"),
  platform: async (): Promise<string> => ipcRenderer.invoke("get-platform"),
  syncTitleBarOverlay: async (theme: "dark" | "light" | "dim") =>
    ipcRenderer.invoke("sync-title-bar-overlay", theme) as Promise<{ ok: boolean; skipped?: boolean; error?: string }>,
  getConnectionMode: async (): Promise<"local" | "remote"> => ipcRenderer.invoke("get-connection-mode"),
  getBackendScopeSync: (): string => queryBackendScopeSync(),
  getConnectionModeSync: (): "local" | "remote" => queryConnectionModeSync(),
  onConnectionModeChanged: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on("agx-connection-mode-changed", handler);
    return () => ipcRenderer.removeListener("agx-connection-mode-changed", handler);
  },
  onStudioReady: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on("agx-studio-ready", handler);
    return () => ipcRenderer.removeListener("agx-studio-ready", handler);
  },
  appRelaunch: async (): Promise<{ ok: boolean }> => ipcRenderer.invoke("app-relaunch"),
  focusModeEnter: async (): Promise<{ ok: boolean; alreadyActive?: boolean; error?: string }> =>
    ipcRenderer.invoke("focus-mode-enter"),
  focusModeExit: async (): Promise<{ ok: boolean; alreadyInactive?: boolean; error?: string }> =>
    ipcRenderer.invoke("focus-mode-exit"),
  loadRemoteServer: async () =>
    ipcRenderer.invoke("load-remote-server") as Promise<{ enabled: boolean; url: string; token: string }>,
  saveRemoteServer: async (payload: { enabled: boolean; url: string; token: string }) =>
    ipcRenderer.invoke("save-remote-server", payload),
  testRemoteServer: async (payload: { url: string; token: string }) =>
    ipcRenderer.invoke("test-remote-server", payload),
  loadGatewayIm: async () =>
    ipcRenderer.invoke("load-gateway-im") as Promise<{
      enabled: boolean;
      url: string;
      deviceId: string;
      token: string;
      studioBaseUrl: string;
    }>,
  saveGatewayIm: async (payload: {
    enabled: boolean;
    url: string;
    deviceId: string;
    token: string;
    studioBaseUrl: string;
  }) => ipcRenderer.invoke("save-gateway-im", payload),
  loadFeishuConfig: async () =>
    ipcRenderer.invoke("load-feishu-config") as Promise<{
      enabled: boolean;
      appId: string;
      appSecret: string;
    }>,
  saveFeishuConfig: async (payload: {
    enabled: boolean;
    appId: string;
    appSecret: string;
  }) => ipcRenderer.invoke("save-feishu-config", payload),
  loadFeishuBinding: async () =>
    ipcRenderer.invoke("load-feishu-binding") as Promise<{ ok: boolean; bindings: Record<string, unknown> }>,
  saveFeishuDesktopBinding: async (payload: {
    sessionId: string | null;
    avatarId?: string | null;
    avatarName?: string | null;
    provider?: string | null;
    model?: string | null;
  }) => ipcRenderer.invoke("save-feishu-desktop-binding", payload),

  loadWechatBinding: async () =>
    ipcRenderer.invoke("load-wechat-binding") as Promise<{ ok: boolean; bindings: Record<string, unknown> }>,
  saveWechatDesktopBinding: async (payload: {
    sessionId: string | null;
    avatarId?: string | null;
    avatarName?: string | null;
    provider?: string | null;
    model?: string | null;
  }) => ipcRenderer.invoke("save-wechat-desktop-binding", payload),

  wechatSidecarStart: async () =>
    ipcRenderer.invoke("wechat-sidecar-start") as Promise<{ ok: boolean; port: number }>,
  wechatSidecarStop: async () =>
    ipcRenderer.invoke("wechat-sidecar-stop") as Promise<{ ok: boolean }>,
  wechatSidecarPort: async () =>
    ipcRenderer.invoke("wechat-sidecar-port") as Promise<{ port: number; running: boolean }>,
  wechatClearCredentials: async () =>
    ipcRenderer.invoke("wechat-clear-credentials") as Promise<{ ok: boolean }>,

  onOpenSettings: (cb: () => void): void => {
    ipcRenderer.on("open-settings", () => cb());
  },
  onSkillsChanged: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on("skills-changed", handler);
    return () => ipcRenderer.removeListener("skills-changed", handler);
  },
  onAutomationTaskProgress: (
    cb: (payload: {
      taskId: string;
      taskName: string;
      trigger: "schedule" | "manual";
      phase: "queued" | "running" | "success" | "error";
      sessionId?: string;
      message?: string;
      ts: number;
    }) => void
  ): (() => void) => {
    const handler = (
      _event: unknown,
      payload: {
        taskId: string;
        taskName: string;
        trigger: "schedule" | "manual";
        phase: "queued" | "running" | "success" | "error";
        sessionId?: string;
        message?: string;
        ts: number;
      }
    ) => cb(payload);
    ipcRenderer.on("automation-task-progress", handler);
    return () => ipcRenderer.removeListener("automation-task-progress", handler);
  },

  diagnoseBackendDeps: async () => ipcRenderer.invoke("diagnose-backend-deps"),
  repairBackendDeps: async () => ipcRenderer.invoke("repair-backend-deps"),
  onBackendDepsProgress: (
    cb: (payload: { phase: string; line?: string; pct?: number }) => void,
  ) => {
    const handler = (
      _e: unknown,
      payload: { phase: string; line?: string; pct?: number },
    ) => cb(payload);
    ipcRenderer.on("backend-deps-progress", handler);
    return () => ipcRenderer.removeListener("backend-deps-progress", handler);
  },

  listAvatars: async () => ipcRenderer.invoke("list-avatars"),
  createAvatar: async (payload: {
    name: string;
    role?: string;
    avatar_url?: string;
    system_prompt?: string;
    created_by?: string;
    tools_enabled?: Record<string, boolean>;
    skills_enabled?: Record<string, boolean> | null;
    default_provider?: string;
    default_model?: string;
    workspace_dir?: string;
  }) =>
    ipcRenderer.invoke("create-avatar", payload),
  updateAvatar: async (payload: {
    id: string;
    name?: string;
    role?: string;
    avatar_url?: string;
    pinned?: boolean;
    system_prompt?: string;
    tools_enabled?: Record<string, boolean>;
    skills_enabled?: Record<string, boolean> | null;
    brains_enabled?: "*" | string[] | null;
    default_provider?: string;
    default_model?: string;
  }) =>
    ipcRenderer.invoke("update-avatar", payload),
  deleteAvatar: async (id: string) => ipcRenderer.invoke("delete-avatar", id),
  getToolsStatus: async () => ipcRenderer.invoke("get-tools-status"),
  getToolsRegistry: async () => ipcRenderer.invoke("get-tools-registry"),
  getToolsPolicy: async () => ipcRenderer.invoke("get-tools-policy"),
  saveToolsPolicy: async (payload: {
    tools_enabled: Record<string, boolean>;
    tools_options?: Record<string, unknown>;
  }) => ipcRenderer.invoke("save-tools-policy", payload),
  installTool: async (payload: { requestId: string; toolId: string }) =>
    ipcRenderer.invoke("install-tool", payload),
  onToolInstallProgress: (cb: (payload: {
    requestId: string;
    tool_id: string;
    phase: string;
    percent: number;
    message: string;
    installed?: boolean;
    version?: string;
    install_command?: string;
  }) => void): (() => void) => {
    const handler = (_event: unknown, payload: {
      requestId: string;
      tool_id: string;
      phase: string;
      percent: number;
      message: string;
      installed?: boolean;
      version?: string;
      install_command?: string;
    }) => cb(payload);
    ipcRenderer.on("tool-install-progress", handler);
    return () => ipcRenderer.removeListener("tool-install-progress", handler);
  },

  listSessions: async (avatarId?: string) => ipcRenderer.invoke("list-sessions", avatarId),
  interruptSession: async (sessionId: string) => ipcRenderer.invoke("interrupt-session", sessionId),
  loadRuntimeConfig: async () => ipcRenderer.invoke("load-runtime-config"),
  saveRuntimeConfig: async (payload: {
    max_tool_rounds?: number;
    max_taskspaces?: number;
    auto_resume_on_exhaustion?: boolean;
    max_auto_resumes?: number;
  }) =>
    ipcRenderer.invoke("save-runtime-config", payload),
  searchSessions: async (payload: { q: string; avatarId?: string }) => {
    const params = new URLSearchParams();
    params.set("q", (payload.q || "").trim());
    if (payload.avatarId) params.set("avatar_id", payload.avatarId);
    return desktopApiFetch<{ ok: boolean; hits?: Array<{ session_id: string; snippet: string }>; error?: string }>(
      `/api/sessions/search?${params.toString()}`
    );
  },
  createSession: async (payload: {
    avatar_id?: string;
    name?: string;
    inherit_from_session_id?: string;
    session_mode?: "code_dev" | "daily_office";
    provider?: string;
    model?: string;
  }) =>
    ipcRenderer.invoke("create-session", payload),
  renameSession: async (payload: { sessionId: string; name: string }) =>
    ipcRenderer.invoke("rename-session", payload),
  deleteSession: async (sessionId: string) =>
    ipcRenderer.invoke("delete-session", sessionId),
  deleteSessionsBatch: async (sessionIds: string[]) =>
    ipcRenderer.invoke("delete-sessions-batch", sessionIds),
  pinSession: async (payload: { sessionId: string; pinned: boolean }) =>
    ipcRenderer.invoke("pin-session", payload),
  setSessionModel: async (payload: { sessionId: string; provider: string; model: string }) =>
    ipcRenderer.invoke("set-session-model", payload),
  loadLayout: async () => ipcRenderer.invoke("layout-get"),
  saveUiPrefs: async (payload: { theme: "dark" | "light" | "dim" }) =>
    ipcRenderer.invoke("ui-prefs-set", payload) as Promise<{ ok: boolean; error?: string }>,
  saveLayout: async (payload: {
    panes?: Array<{
      id: string;
      avatarId: string | null;
      sessionId: string;
      modelProvider: string;
      modelName: string;
    }>;
    activePaneId?: string;
  }) => ipcRenderer.invoke("layout-set", payload),
  forkSession: async (payload: { sessionId: string }) =>
    ipcRenderer.invoke("fork-session", payload),
  archiveSessions: async (payload: { sessionId: string; avatarId?: string | null }) =>
    ipcRenderer.invoke("archive-sessions", payload),
  listTaskspaces: async (sessionId: string) =>
    desktopApiFetch(`/api/taskspace/workspaces?session_id=${encodeURIComponent(sessionId)}`),
  addTaskspace: async (payload: { sessionId: string; path?: string; label?: string }) =>
    desktopApiFetch("/api/taskspace/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: payload.sessionId,
        path: payload.path,
        label: payload.label,
      }),
    }),
  removeTaskspace: async (payload: { sessionId: string; taskspaceId: string }) =>
    desktopApiFetch("/api/taskspace/workspaces", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: payload.sessionId,
        taskspace_id: payload.taskspaceId,
      }),
    }),
  chooseDirectory: async () => ipcRenderer.invoke("choose-directory"),
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file) || "";
    } catch {
      return "";
    }
  },
  listTaskspaceFiles: async (payload: { sessionId: string; taskspaceId: string; path?: string }) =>
    desktopApiFetch(
      `/api/taskspace/files?session_id=${encodeURIComponent(payload.sessionId)}&taskspace_id=${encodeURIComponent(payload.taskspaceId)}&path=${encodeURIComponent(payload.path || ".")}`
    ),
  readTaskspaceFile: async (payload: { sessionId: string; taskspaceId: string; path: string }) =>
    desktopApiFetch(
      `/api/taskspace/file?session_id=${encodeURIComponent(payload.sessionId)}&taskspace_id=${encodeURIComponent(payload.taskspaceId)}&path=${encodeURIComponent(payload.path)}`
    ),
  loadSessionMessages: async (sessionId: string) =>
    ipcRenderer.invoke("load-session-messages", sessionId),
  loadSessionMessagesPage: async (
    sessionId: string,
    options: { tailRounds?: number; tailLimit?: number; beforeIndex?: number; limit?: number } = {}
  ) => ipcRenderer.invoke("load-session-messages-page", sessionId, options),
  forkAvatar: async (payload: { sessionId: string; name: string; role?: string }) =>
    ipcRenderer.invoke("fork-avatar", payload),
  generateAvatar: async (payload: { description: string }) =>
    ipcRenderer.invoke("generate-avatar", payload),

  listGroups: async () => ipcRenderer.invoke("list-groups"),
  createGroup: async (payload: { name: string; avatar_ids: string[]; routing?: string }) =>
    ipcRenderer.invoke("create-group", payload),
  updateGroup: async (payload: { id: string; name?: string; avatar_ids?: string[]; routing?: string }) =>
    ipcRenderer.invoke("update-group", payload),
  deleteGroup: async (id: string) => ipcRenderer.invoke("delete-group", id),

  loadConfig: async () => ipcRenderer.invoke("load-config"),
  loadWorkspaceConfig: async () => ipcRenderer.invoke("load-workspace-config"),
  saveWorkspaceConfig: async (payload: { workspaceDir: string }) =>
    ipcRenderer.invoke("save-workspace-config", payload),
  loadMetaSoul: async () => ipcRenderer.invoke("load-meta-soul"),
  saveMetaSoul: async (payload: { content: string }) => ipcRenderer.invoke("save-meta-soul", payload),
  loadMetaIdentity: async () => ipcRenderer.invoke("load-meta-identity"),
  saveMetaIdentity: async (payload: { content: string }) => ipcRenderer.invoke("save-meta-identity", payload),
  aiAssistComplete: async (payload: {
    systemPrompt: string;
    userPrompt: string;
    provider?: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  }) => ipcRenderer.invoke("ai-assist-complete", payload),
  listMetaWorkspaceHistory: async (payload: { kind: "identity" | "soul" }) =>
    ipcRenderer.invoke("list-meta-workspace-history", payload),
  restoreMetaWorkspaceHistory: async (payload: { kind: "identity" | "soul"; id: string }) =>
    ipcRenderer.invoke("restore-meta-workspace-history", payload),
  openMetaWorkspaceFile: async (payload: { kind: "identity" | "soul" }) =>
    ipcRenderer.invoke("open-meta-workspace-file", payload),
  loadUserMd: async () => ipcRenderer.invoke("load-user-md"),
  saveUserMd: async (payload: { content: string }) => ipcRenderer.invoke("save-user-md", payload),
  loadAvatarSoul: async (payload: { avatarId: string }) => ipcRenderer.invoke("load-avatar-soul", payload),
  saveAvatarSoul: async (payload: { avatarId: string; content: string }) =>
    ipcRenderer.invoke("save-avatar-soul", payload),
  loadComputerUseConfig: async () => ipcRenderer.invoke("load-computer-use-config"),
  saveComputerUseConfig: async (payload: { enabled: boolean }) =>
    ipcRenderer.invoke("save-computer-use-config", payload),
  loadCodeIndexConfig: async () => ipcRenderer.invoke("load-code-index-config"),
  saveCodeIndexConfig: async (payload: Record<string, unknown>) =>
    ipcRenderer.invoke("save-code-index-config", payload),
  openCodeIndexModelCache: async () => ipcRenderer.invoke("open-code-index-model-cache"),
  loadTrinityConfig: async () => ipcRenderer.invoke("load-trinity-config"),
  saveTrinityConfig: async (payload: {
    skill_protocol: boolean;
    session_summary: boolean;
    learning_enabled: boolean;
    skill_manage_enabled: boolean;
    learning_nudge_interval: number;
    learning_min_tool_calls: number;
  }) => ipcRenderer.invoke("save-trinity-config", payload),
  loadTurnArchiveConfig: async () => ipcRenderer.invoke("load-turn-archive-config"),
  saveTurnArchiveConfig: async (payload: {
    enabled: boolean;
    min_chunk_chars: number;
    max_chunks_per_turn: number;
    recall_turns_limit: number;
    halflife_days: number;
  }) => ipcRenderer.invoke("save-turn-archive-config", payload),
  loadAutomationConfig: async () => ipcRenderer.invoke("load-automation-config"),
  saveAutomationConfig: async (payload: { prevent_sleep: boolean }) =>
    ipcRenderer.invoke("save-automation-config", payload),
  confirmDialog: async (payload: {
    title?: string;
    message: string;
    detail?: string;
    confirmText?: string;
    cancelText?: string;
    destructive?: boolean;
  }) =>
    ipcRenderer.invoke("confirm-dialog", payload) as Promise<{
      ok: boolean;
      confirmed: boolean;
      error?: string;
    }>,
  exportMessagesPdf: async (payload: { html: string; defaultFileName?: string }) =>
    ipcRenderer.invoke("export-messages-pdf", payload) as Promise<{
      ok: boolean;
      canceled?: boolean;
      path?: string;
      error?: string;
    }>,
  loadAutomationTasks: async () =>
    ipcRenderer.invoke("load-automation-tasks") as Promise<{
      ok: boolean;
      tasks: Array<Record<string, unknown>>;
      error?: string;
    }>,
  saveAutomationTask: async (task: Record<string, unknown>) =>
    ipcRenderer.invoke("save-automation-task", task) as Promise<{ ok: boolean; error?: string }>,
  deleteAutomationTask: async (
    taskIdOrOpts: string | { taskId: string; removeCrontaskDir?: boolean },
  ) =>
    ipcRenderer.invoke("delete-automation-task", taskIdOrOpts) as Promise<{
      ok: boolean;
      error?: string;
    }>,
  automationCrontaskDirInfo: async (taskId: string) =>
    ipcRenderer.invoke("automation-crontask-dir-info", taskId) as Promise<{
      ok: boolean;
      path: string;
      exists: boolean;
    }>,
  cancelAutomationTaskRun: async (taskId: string) =>
    ipcRenderer.invoke("cancel-automation-task-run", taskId) as Promise<{ ok: boolean; error?: string }>,
  readAutomationTaskLog: async (payload: string | { taskId: string; tail?: number }) =>
    ipcRenderer.invoke("read-automation-task-log", payload) as Promise<{
      ok: boolean;
      error?: string;
      path: string;
      lines: string[];
      truncated?: boolean;
      empty?: boolean;
    }>,
  runAutomationTaskNow: async (payload: string | { taskId: string; sessionId?: string }) =>
    ipcRenderer.invoke("run-automation-task-now", payload) as Promise<{ ok: boolean; error?: string }>,
  loadSkillInstallPolicy: async () => ipcRenderer.invoke("load-skill-install-policy"),
  saveSkillInstallPolicy: async (payload: { non_high_risk_auto_install: boolean }) =>
    ipcRenderer.invoke("save-skill-install-policy", payload),
  loadEmailConfig: async () => ipcRenderer.invoke("load-email-config"),
  loadMcpStatus: async (sessionId: string) => ipcRenderer.invoke("load-mcp-status", sessionId),
  importMcpConfig: async (payload: { sessionId: string; sourcePath: string }) =>
    ipcRenderer.invoke("import-mcp-config", payload),
  getMcpSettings: async () => ipcRenderer.invoke("get-mcp-settings"),
  putMcpSettings: async (payload: {
    extraSearchPaths: string[];
    disabledTools?: Record<string, string[]>;
    skipDefaultNames?: string[];
  }) =>
    ipcRenderer.invoke("put-mcp-settings", payload),
  mcpDiscover: async () => ipcRenderer.invoke("mcp-discover"),
  mcpGetRaw: async (payload?: { path?: string }) => ipcRenderer.invoke("mcp-get-raw", payload),
  mcpPutRaw: async (payload: { path: string; text: string }) => ipcRenderer.invoke("mcp-put-raw", payload),
  mcpGatewayRegistry: async (payload: { baseUrl: string; token: string }) =>
    ipcRenderer.invoke("mcp-gateway-registry", payload),
  mcpMarketplaceList: async (payload?: {
    category?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    isHosted?: boolean;
    isVerified?: boolean;
  }) => ipcRenderer.invoke("mcp-marketplace-list", payload),
  mcpMarketplaceDetail: async (payload: { serverId: string }) =>
    ipcRenderer.invoke("mcp-marketplace-detail", payload),
  mcpMarketplaceInstall: async (payload: { serverId: string; env?: Record<string, string> }) =>
    ipcRenderer.invoke("mcp-marketplace-install", payload),
  resolveLocalPath: async (path: string) => ipcRenderer.invoke("resolve-local-path", path),
  shellOpenPath: async (path: string) => ipcRenderer.invoke("shell-open-path", path),
  shellShowItemInFolder: async (path: string) => ipcRenderer.invoke("shell-show-item-in-folder", path),
  connectMcp: async (payload: { sessionId: string; name: string }) =>
    ipcRenderer.invoke("connect-mcp", payload),
  disconnectMcp: async (payload: { sessionId: string; name: string }) =>
    ipcRenderer.invoke("disconnect-mcp", payload),
  saveUserMode: async (mode: "pro" | "lite") => ipcRenderer.invoke("save-user-mode", mode),
  saveOnboardingCompleted: async (completed: boolean) =>
    ipcRenderer.invoke("save-onboarding-completed", completed),
  saveConfirmStrategy: async (strategy: "manual" | "semi-auto" | "auto") =>
    ipcRenderer.invoke("save-confirm-strategy", strategy),
  saveEmailConfig: async (payload: {
    enabled: boolean;
    smtp_host: string;
    smtp_port: number;
    smtp_username: string;
    smtp_password: string;
    smtp_use_tls: boolean;
    from_email: string;
    default_to_email: string;
  }) => ipcRenderer.invoke("save-email-config", payload),
  testEmailConfig: async (payload: {
    config: {
      enabled: boolean;
      smtp_host: string;
      smtp_port: number;
      smtp_username: string;
      smtp_password: string;
      smtp_use_tls: boolean;
      from_email: string;
      default_to_email: string;
    };
    toEmail?: string;
  }) => ipcRenderer.invoke("test-email-config", payload),
  saveProvider: async (payload: {
    name: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    models?: string[];
    enabled?: boolean;
    dropParams?: boolean;
    displayName?: string;
    interface?: "openai" | "ollama";
  }) => ipcRenderer.invoke("save-provider", payload),
  setDefaultProvider: async (name: string) => ipcRenderer.invoke("set-default-provider", name),
  deleteProvider: async (name: string) => ipcRenderer.invoke("delete-provider", name),
  validateKey: async (payload: { provider: string; apiKey: string; baseUrl?: string }) =>
    ipcRenderer.invoke("validate-key", payload),
  fetchModels: async (payload: { provider: string; apiKey: string; baseUrl?: string }) =>
    ipcRenderer.invoke("fetch-models", payload),
  healthCheckModel: async (payload: {
    provider: string;
    apiKey: string;
    baseUrl?: string;
    model: string;
  }) => ipcRenderer.invoke("health-check-model", payload),

  // Legacy
  saveConfig: async (payload: { provider?: string; model?: string; apiKey?: string; activeProvider?: string; activeModel?: string }) =>
    ipcRenderer.invoke("save-config", payload),
  nativeSay: async (text: string) => ipcRenderer.invoke("native-say", text),

  // Skills
  loadSkills: async () => ipcRenderer.invoke("load-skills"),
  loadSkillDetail: async (args: { name: string }) => ipcRenderer.invoke("load-skill-detail", args),
  refreshSkills: async () => ipcRenderer.invoke("refresh-skills"),
  getSkillSettings: async () => ipcRenderer.invoke("get-skill-settings"),
  getGuardSettings: async () => ipcRenderer.invoke("get-guard-settings"),
  putGuardSettings: async (payload: {
    version?: number;
    scan_mode?: string;
    llm_verify?: boolean;
    ignored?: string[];
    add_ignore?: string;
    remove_ignore?: string;
  }) => ipcRenderer.invoke("put-guard-settings", payload),
  guardScanSkill: async (payload: {
    skill_path?: string;
    markdown?: string;
    skill_name?: string;
    mode?: string;
  }) => ipcRenderer.invoke("guard-scan-skill", payload),
  guardScanAll: async (payload?: { include_ignored?: boolean }) =>
    ipcRenderer.invoke("guard-scan-all", payload ?? {}),
  skillSnapshot: async (payload: {
    base_dir: string;
    trigger?: string;
    skill_name?: string;
  }) => ipcRenderer.invoke("skill-snapshot", payload),
  skillSnapshotsList: async (payload: { base_dir: string }) =>
    ipcRenderer.invoke("skill-snapshots-list", payload),
  skillSnapshotRestore: async (payload: { base_dir: string; snapshot_id: string }) =>
    ipcRenderer.invoke("skill-snapshot-restore", payload),
  putSkillSettings: async (payload: {
    presetPaths: Array<{ id: string; enabled: boolean }>;
    customPaths: string[];
    preferredSources?: Record<string, string>;
    disabledSkills?: string[];
  }) => ipcRenderer.invoke("put-skill-settings", payload),

  // Bundles
  loadBundles: async () => ipcRenderer.invoke("load-bundles"),
  installBundle: async (args: {
    sourcePath: string;
    acknowledgeHighRisk?: boolean;
    confirmNonHighRisk?: boolean;
  }) => ipcRenderer.invoke("install-bundle", args),
  installBundlePreview: async (args: { sourcePath: string }) =>
    ipcRenderer.invoke("install-bundle-preview", args),
  uninstallBundle: async (args: { name: string }) => ipcRenderer.invoke("uninstall-bundle", args),

  // Registry marketplace
  searchRegistry: async (args: { q: string }) => ipcRenderer.invoke("search-registry", args),
  searchSkillHub: async (args: { q: string }) => ipcRenderer.invoke("search-skillhub", args),
  loadLocalImageDataUrl: async (path: string) => ipcRenderer.invoke("load-local-image-data-url", path),
  writeLocalTextFile: async (payload: { path: string; content: string }) =>
    ipcRenderer.invoke("write-local-text-file", payload),
  readLocalTextFile: async (path: string) => ipcRenderer.invoke("read-local-text-file", path),
  loadLocalFileDataUrl: async (path: string) => ipcRenderer.invoke("load-local-file-data-url", path),
  installFromRegistry: async (args: {
    source: string;
    name: string;
    acknowledgeHighRisk?: boolean;
    confirmNonHighRisk?: boolean;
  }) => ipcRenderer.invoke("install-from-registry", args),
  installFromRegistryPreview: async (args: { source: string; name: string }) =>
    ipcRenderer.invoke("install-from-registry-preview", args),

  terminalSpawn: async (payload: { id: string; cwd: string; cols?: number; rows?: number }) =>
    ipcRenderer.invoke("terminal-spawn", payload) as Promise<{ ok: boolean; id?: string; error?: string }>,
  terminalBridgeAttach: async (payload: {
    id: string;
    sessionId: string;
    baseUrl: string;
    token: string;
    cols?: number;
    rows?: number;
  }) =>
    ipcRenderer.invoke("terminal-bridge-attach", payload) as Promise<{
      ok: boolean;
      id?: string;
      error?: string;
    }>,
  terminalWrite: async (payload: { id: string; data: string }) =>
    ipcRenderer.invoke("terminal-write", payload) as Promise<{ ok: boolean }>,
  terminalWriteByTab: async (payload: { tabId: string; data: string }) =>
    ipcRenderer.invoke("terminal-write-by-tab", payload) as Promise<{ ok: boolean; id?: string }>,
  terminalResize: async (payload: { id: string; cols: number; rows: number }) =>
    ipcRenderer.invoke("terminal-resize", payload) as Promise<{ ok: boolean }>,
  terminalKill: async (id: string) => ipcRenderer.invoke("terminal-kill", id) as Promise<{ ok: boolean }>,
  onTerminalData: (cb: (payload: { id: string; data: string }) => void): (() => void) => {
    const handler = (_e: unknown, payload: { id: string; data: string }) => cb(payload);
    ipcRenderer.on("terminal-data", handler);
    return () => ipcRenderer.removeListener("terminal-data", handler);
  },
  onTerminalExit: (cb: (payload: { id: string }) => void): (() => void) => {
    const handler = (_e: unknown, payload: { id: string }) => cb(payload);
    ipcRenderer.on("terminal-exit", handler);
    return () => ipcRenderer.removeListener("terminal-exit", handler);
  },

  agxAccountLoginStart: async () =>
    ipcRenderer.invoke("agx-account-login-start") as Promise<{
      ok: boolean;
      device_id?: string;
      open_url?: string;
      error?: string;
    }>,
  agxAccountLoginCancel: async () =>
    ipcRenderer.invoke("agx-account-login-cancel") as Promise<{ ok: boolean }>,
  agxAccountLogout: async () => ipcRenderer.invoke("agx-account-logout") as Promise<{ ok: boolean }>,
  loadAgxAccount: async () =>
    ipcRenderer.invoke("load-agx-account") as Promise<{
      ok: boolean;
      loggedIn?: boolean;
      email?: string;
      displayName?: string;
    }>,
  onAgxAccountChanged: (cb: (payload: { email: string; displayName: string }) => void): (() => void) => {
    const handler = (_e: unknown, payload: { email: string; displayName: string }) => cb(payload);
    ipcRenderer.on("agx-account-changed", handler);
    return () => ipcRenderer.removeListener("agx-account-changed", handler);
  },
  onAgxAccountLoginTimeout: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on("agx-account-login-timeout", handler);
    return () => ipcRenderer.removeListener("agx-account-login-timeout", handler);
  },
  updateSplashStage: async (stage: string) =>
    ipcRenderer.invoke("update-splash-stage", stage) as Promise<{ ok: boolean }>,
  getSplashPreloadEnabled: async () =>
    ipcRenderer.invoke("get-splash-preload-enabled") as Promise<{ enabled: boolean }>,
  preloadCoreData: async (payload: { avatarId?: string; sessionId?: string }) =>
    ipcRenderer.invoke("preload-core-data", payload),
  startupRendererReady: async (): Promise<{ ok: boolean; duplicate?: boolean }> =>
    ipcRenderer.invoke("startup:renderer-ready") as Promise<{ ok: boolean; duplicate?: boolean }>,

  systemSearch: async (payload: {
    query: string;
    category?: "all" | "documents" | "applications" | "images" | "folders" | "videos";
  }) =>
    ipcRenderer.invoke("system-search", payload) as Promise<{
      ok: boolean;
      items: Array<{
        path: string;
        name: string;
        ext: string;
        kind: "folder" | "document" | "application" | "image" | "video" | "other";
        size: number;
        mtime: number;
      }>;
      error?: string;
      warning?: string;
      timedOut?: boolean;
      engine?: string;
    }>,
  systemSearchPreview: async (filePath: string) =>
    ipcRenderer.invoke("system-search:preview", filePath) as Promise<{
      ok: boolean;
      kind: "text" | "image" | "metadata";
      content?: string;
      fileUrl?: string;
      truncated?: boolean;
      error?: string;
    }>,
  systemSearchOpen: async (filePath: string) =>
    ipcRenderer.invoke("system-search:open", filePath) as Promise<{ ok: boolean; error?: string }>,
  systemSearchReveal: async (filePath: string) =>
    ipcRenderer.invoke("system-search:reveal", filePath) as Promise<{ ok: boolean; error?: string }>,
  systemSearchGetInfo: async (filePath: string) =>
    ipcRenderer.invoke("system-search:get-info", filePath) as Promise<{ ok: boolean; error?: string }>,
  systemSearchOpenWith: async (filePath: string) =>
    ipcRenderer.invoke("system-search:open-with", filePath) as Promise<{
      ok: boolean;
      hint?: string;
      error?: string;
    }>,
  openExternal: async (url: string) =>
    ipcRenderer.invoke("open-external", url) as Promise<{ ok: boolean; error?: string }>,
});
