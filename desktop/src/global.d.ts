export {};

type ProviderConfig = {
  api_key?: string;
  base_url?: string;
  model?: string;
  models?: string[];
  drop_params?: boolean;
};

type LoadConfigResult = {
  defaultProvider: string;
  providers: Record<string, ProviderConfig>;
  userMode?: "pro" | "lite";
  onboardingCompleted?: boolean;
  confirmStrategy?: "manual" | "semi-auto" | "auto";
  activeProvider?: string;
  activeModel?: string;
};

type ValidateKeyResult = { ok: boolean; error?: string; status?: number };
type FetchModelsResult = { ok: boolean; models: string[]; error?: string };
type HealthCheckResult = { ok: boolean; error?: string; latencyHint?: string };
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

type ComputerUseConfig = {
  enabled: boolean;
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

type AutomationFrequencyData =
  | { type: "daily"; time: string; days: number[] }
  | { type: "interval"; hours: number; days: number[] }
  | { type: "once"; time: string; date: string };

type AutomationTaskData = {
  id: string;
  name: string;
  prompt: string;
  workspace?: string;
  sessionId?: string;
  frequency: AutomationFrequencyData;
  effectiveDateRange?: { start?: string; end?: string };
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  lastRunStatus?: "success" | "error";
  fromTemplate?: string;
};

type AutomationTaskProgress = {
  taskId: string;
  taskName: string;
  trigger: "schedule" | "manual";
  phase: "queued" | "running" | "success" | "error";
  sessionId?: string;
  message?: string;
  ts: number;
};

type SkillInstallPolicyConfig = {
  non_high_risk_auto_install: boolean;
};

type SkillScanPayload = {
  overall: string;
  skills: Array<{
    skill_name: string;
    verdict: string;
    findings: Array<{
      severity: string;
      pattern_name: string;
      matched_text: string;
      file_path: string;
      line_number: number;
    }>;
  }>;
  bundle_name?: string;
};
type AvatarItem = {
  id: string;
  name: string;
  role?: string;
  avatar_url?: string;
  pinned?: boolean;
  created_by?: string;
  system_prompt?: string;
  tools_enabled?: Record<string, boolean>;
  skills_enabled?: Record<string, boolean> | null;
};

type ToolStatusItem = {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  version?: string;
  install_command?: string;
  auto_installable?: boolean;
};

type ToolInstallProgress = {
  requestId: string;
  tool_id: string;
  phase: string;
  percent: number;
  message: string;
  installed?: boolean;
  version?: string;
  install_command?: string;
};

type ToolsOptionsPayload = {
  bash_exec?: { default_timeout_sec?: number };
};

type ToolsPolicy = {
  tools_enabled: Record<string, boolean>;
  tools_options?: ToolsOptionsPayload;
};

type GroupItem = {
  id: string;
  name: string;
  avatar_ids: string[];
  routing?: string;
};
type ForwardedHistoryItem = {
  sender: string;
  role: string;
  content: string;
  avatar_url?: string;
  timestamp?: number;
};
type ForwardedHistoryCard = {
  title: string;
  source_session: string;
  items: ForwardedHistoryItem[];
};
type TaskspaceItem = {
  id: string;
  label: string;
  path: string;
};
type TaskspaceFileItem = {
  name: string;
  type: "file" | "dir";
  path: string;
  size: number;
  modified: number;
};

type McpServerItem = { name: string; connected: boolean; command?: string };
type McpStatusResult = {
  ok: boolean;
  count?: number;
  connected_count?: number;
  servers: McpServerItem[];
  error?: string;
};

type SkillItem = {
  skill_id?: string;
  name: string;
  description: string;
  location: string;
  base_dir?: string;
  source?: string;
  tag?: string;
  icon?: string;
  content_hash?: string;
  globally_disabled?: boolean;
  conflict_count?: number;
  variants?: Array<{
    skill_id?: string;
    source?: string;
    base_dir?: string;
    location?: string;
    content_hash?: string;
  }>;
};
type SkillListResult = { ok: boolean; items: SkillItem[]; count: number; error?: string };
type SkillScanPresetRow = { id: string; label: string; path: string; enabled: boolean };
type SkillSettingsResult = {
  ok: boolean;
  preset_paths?: SkillScanPresetRow[];
  custom_paths?: string[];
  preferred_sources?: Record<string, string>;
  disabled_skills?: string[];
  error?: string;
};
type SkillDetailResult = {
  ok: boolean;
  name: string;
  description: string;
  location: string;
  source?: string;
  content: string;
  error?: string;
};
type SkillRefreshResult = { ok: boolean; count: number; error?: string };

type BundleItem = {
  name: string;
  version: string;
  description: string;
  author: string;
  installed_at: string;
  source_dir: string;
  skills: string[];
  mcp_servers: string[];
  avatars: string[];
  memory_templates: string[];
};
type BundleListResult = { ok: boolean; items: BundleItem[]; count: number; error?: string };
type BundleInstallResult = {
  ok: boolean;
  name?: string;
  version?: string;
  skills_installed?: string[];
  mcp_servers_installed?: string[];
  avatars_installed?: string[];
  memory_templates_installed?: string[];
  error?: string;
  error_code?: string;
  scan_summary?: SkillScanPayload;
};
type BundleUninstallResult = { ok: boolean; name?: string; error?: string };

type RegistrySearchItem = {
  name: string;
  description: string;
  version: string;
  author: string;
  source: string;
  source_type: string;
  install_hint: string;
};
type RegistrySearchResult = { ok: boolean; items: RegistrySearchItem[]; count: number; error?: string };

type SkillHubSearchItem = {
  slug: string;
  name: string;
  description: string;
  version: string;
  author: string;
  downloads?: string | number;
};
type SkillHubSearchResult = {
  ok: boolean;
  items: SkillHubSearchItem[];
  count?: number;
  source?: string;
  hint?: string;
  error?: string;
};

type RegistryInstallResult = {
  ok: boolean;
  name?: string;
  installed_path?: string;
  error?: string;
  error_code?: string;
  scan_summary?: SkillScanPayload;
};
type BundleInstallPreviewResult = {
  ok: boolean;
  scan?: SkillScanPayload;
  error?: string;
};
type RegistryInstallPreviewResult = {
  ok: boolean;
  scan?: SkillScanPayload;
  error?: string;
};

declare global {
  interface Window {
    agenticxDesktop: {
      version: string;
      getApiBase: () => Promise<string>;
      getApiAuthToken: () => Promise<string>;
      platform: () => Promise<string>;
      getConnectionMode: () => Promise<"local" | "remote">;
      loadRemoteServer: () => Promise<{ enabled: boolean; url: string; token: string }>;
      saveRemoteServer: (payload: { enabled: boolean; url: string; token: string }) => Promise<{ ok: boolean; restart_required?: boolean }>;
      testRemoteServer: (payload: { url: string; token: string }) => Promise<{ ok: boolean; status?: number; error?: string }>;
      loadGatewayIm: () => Promise<{
        enabled: boolean;
        url: string;
        deviceId: string;
        token: string;
        studioBaseUrl: string;
      }>;
      saveGatewayIm: (payload: {
        enabled: boolean;
        url: string;
        deviceId: string;
        token: string;
        studioBaseUrl: string;
      }) => Promise<{ ok: boolean; restart_required?: boolean }>;
      loadFeishuConfig: () => Promise<{ enabled: boolean; appId: string; appSecret: string }>;
      saveFeishuConfig: (payload: { enabled: boolean; appId: string; appSecret: string }) => Promise<{ ok: boolean }>;
      loadFeishuBinding: () => Promise<{ ok: boolean; bindings: Record<string, unknown> }>;
      saveFeishuDesktopBinding: (payload: {
        sessionId: string | null;
        avatarId?: string | null;
        avatarName?: string | null;
        provider?: string | null;
        model?: string | null;
      }) => Promise<{ ok: boolean }>;

      loadWechatBinding: () => Promise<{ ok: boolean; bindings: Record<string, unknown> }>;
      saveWechatDesktopBinding: (payload: {
        sessionId: string | null;
        avatarId?: string | null;
        avatarName?: string | null;
        provider?: string | null;
        model?: string | null;
      }) => Promise<{ ok: boolean }>;

      wechatSidecarStart: () => Promise<{ ok: boolean; port: number }>;
      wechatSidecarStop: () => Promise<{ ok: boolean }>;
      wechatSidecarPort: () => Promise<{ port: number; running: boolean }>;

      onOpenSettings: (cb: () => void) => void;
      onSkillsChanged: (cb: () => void) => () => void;
      onAutomationTaskProgress: (cb: (payload: AutomationTaskProgress) => void) => () => void;

      listAvatars: () => Promise<{ ok: boolean; avatars: AvatarItem[] }>;
      createAvatar: (payload: {
        name: string;
        role?: string;
        avatar_url?: string;
        system_prompt?: string;
        created_by?: string;
        tools_enabled?: Record<string, boolean>;
        skills_enabled?: Record<string, boolean> | null;
      }) => Promise<{ ok: boolean; avatar?: AvatarItem; error?: string }>;
      updateAvatar: (payload: {
        id: string;
        name?: string;
        role?: string;
        avatar_url?: string;
        pinned?: boolean;
        system_prompt?: string;
        tools_enabled?: Record<string, boolean>;
        skills_enabled?: Record<string, boolean> | null;
      }) => Promise<{ ok: boolean; avatar?: AvatarItem; error?: string }>;
      deleteAvatar: (id: string) => Promise<{ ok: boolean; error?: string }>;
      getToolsStatus: () => Promise<{ ok: boolean; tools: ToolStatusItem[]; error?: string }>;
      getToolsRegistry: () => Promise<{ ok: boolean; tools: Array<{ name: string; description: string; category: string; is_meta: boolean }>; error?: string }>;
      getToolsPolicy: () => Promise<{
        ok: boolean;
        tools_enabled: Record<string, boolean>;
        tools_options?: ToolsOptionsPayload;
        error?: string;
      }>;
      saveToolsPolicy: (payload: ToolsPolicy) => Promise<{
        ok: boolean;
        tools_enabled?: Record<string, boolean>;
        tools_options?: ToolsOptionsPayload;
        error?: string;
      }>;
      installTool: (payload: { requestId: string; toolId: string }) => Promise<{ ok: boolean; error?: string }>;
      onToolInstallProgress: (cb: (payload: ToolInstallProgress) => void) => () => void;

      listSessions: (avatarId?: string) => Promise<{ ok: boolean; sessions: Array<{ session_id: string; avatar_id: string | null; avatar_name?: string | null; session_name: string | null; updated_at: number; created_at?: number; pinned?: boolean; archived?: boolean }> }>;
      searchSessions: (payload: { q: string; avatarId?: string }) => Promise<{
        ok: boolean;
        hits?: Array<{ session_id: string; snippet: string }>;
        error?: string;
      }>;
      createSession: (payload: { avatar_id?: string; name?: string; inherit_from_session_id?: string }) => Promise<{ ok: boolean; session_id?: string; inherited?: boolean; error?: string }>;
      renameSession: (payload: { sessionId: string; name: string }) => Promise<{ ok: boolean; error?: string }>;
      deleteSession: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
      deleteSessionsBatch: (sessionIds: string[]) => Promise<{ ok: boolean; deleted?: string[]; failed?: string[]; error?: string }>;
      pinSession: (payload: { sessionId: string; pinned: boolean }) => Promise<{ ok: boolean; pinned?: boolean; error?: string }>;
      forkSession: (payload: { sessionId: string }) => Promise<{ ok: boolean; session_id?: string; session_name?: string; error?: string }>;
      archiveSessions: (payload: { sessionId: string; avatarId?: string | null }) => Promise<{ ok: boolean; archived_count?: number; error?: string }>;
      listTaskspaces: (sessionId: string) => Promise<{ ok: boolean; workspaces: TaskspaceItem[]; error?: string }>;
      addTaskspace: (payload: { sessionId: string; path?: string; label?: string }) => Promise<{ ok: boolean; workspace?: TaskspaceItem; error?: string }>;
      removeTaskspace: (payload: { sessionId: string; taskspaceId: string }) => Promise<{ ok: boolean; error?: string }>;
      chooseDirectory: () => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
      listTaskspaceFiles: (payload: { sessionId: string; taskspaceId: string; path?: string }) => Promise<{ ok: boolean; files: TaskspaceFileItem[]; error?: string }>;
      readTaskspaceFile: (payload: { sessionId: string; taskspaceId: string; path: string }) => Promise<{
        ok: boolean;
        name?: string;
        path?: string;
        absolute_path?: string;
        content?: string;
        truncated?: boolean;
        size?: number;
        error?: string;
      }>;
      loadSessionMessages: (sessionId: string) => Promise<{
        ok: boolean;
        messages: Array<{
          id?: string;
          role: "user" | "assistant" | "tool";
          content: string;
          agent_id?: string;
          avatar_name?: string;
          avatar_url?: string;
          provider?: string;
          model?: string;
          quoted_message_id?: string;
          quoted_content?: string;
          timestamp?: number;
          attachments?: Array<{ name?: string; mime_type?: string; size?: number; data_url?: string }>;
          forwarded_history?: ForwardedHistoryCard;
        }>;
        error?: string;
      }>;
      forkAvatar: (payload: { sessionId: string; name: string; role?: string }) => Promise<{ ok: boolean; avatar?: AvatarItem; error?: string }>;
      generateAvatar: (payload: { description: string }) => Promise<{ ok: boolean; avatar?: AvatarItem; error?: string }>;

      listGroups: () => Promise<{ ok: boolean; groups: GroupItem[] }>;
      createGroup: (payload: { name: string; avatar_ids: string[]; routing?: string }) => Promise<{ ok: boolean; group?: GroupItem; error?: string }>;
      updateGroup: (payload: { id: string; name?: string; avatar_ids?: string[]; routing?: string }) => Promise<{ ok: boolean; group?: GroupItem; error?: string }>;
      deleteGroup: (id: string) => Promise<{ ok: boolean; error?: string }>;

      loadConfig: () => Promise<LoadConfigResult>;
      loadMetaSoul: () => Promise<{ ok: boolean; content: string; error?: string }>;
      saveMetaSoul: (payload: { content: string }) => Promise<{ ok: boolean; error?: string }>;
      loadAvatarSoul: (payload: { avatarId: string }) => Promise<{ ok: boolean; content: string; error?: string }>;
      saveAvatarSoul: (payload: {
        avatarId: string;
        content: string;
      }) => Promise<{ ok: boolean; error?: string }>;
      loadComputerUseConfig: () => Promise<{ ok: boolean; config?: ComputerUseConfig; error?: string }>;
      saveComputerUseConfig: (payload: ComputerUseConfig) => Promise<{ ok: boolean; error?: string }>;
      loadTrinityConfig: () => Promise<{ ok: boolean; config?: TrinityConfig; error?: string }>;
      saveTrinityConfig: (payload: TrinityConfig) => Promise<{ ok: boolean; error?: string }>;
      loadAutomationConfig: () => Promise<{ ok: boolean; config?: AutomationConfig; error?: string }>;
      saveAutomationConfig: (payload: AutomationConfig) => Promise<{ ok: boolean; error?: string }>;
      confirmDialog: (payload: {
        title?: string;
        message: string;
        detail?: string;
        confirmText?: string;
        cancelText?: string;
        destructive?: boolean;
      }) => Promise<{ ok: boolean; confirmed: boolean; error?: string }>;
      loadAutomationTasks: () => Promise<{ ok: boolean; tasks: AutomationTaskData[]; error?: string }>;
      saveAutomationTask: (task: AutomationTaskData) => Promise<{ ok: boolean; error?: string }>;
      deleteAutomationTask: (
        taskIdOrOpts: string | { taskId: string; removeCrontaskDir?: boolean },
      ) => Promise<{ ok: boolean; error?: string }>;
      automationCrontaskDirInfo: (
        taskId: string,
      ) => Promise<{ ok: boolean; path: string; exists: boolean }>;
      cancelAutomationTaskRun: (taskId: string) => Promise<{ ok: boolean; error?: string }>;
      runAutomationTaskNow: (
        payload: string | { taskId: string; sessionId?: string },
      ) => Promise<{ ok: boolean; error?: string }>;
      loadSkillInstallPolicy: () => Promise<{ ok: boolean; config?: SkillInstallPolicyConfig; error?: string }>;
      saveSkillInstallPolicy: (payload: SkillInstallPolicyConfig) => Promise<{ ok: boolean; error?: string }>;
      loadEmailConfig: () => Promise<{ ok: boolean; config: EmailConfig; error?: string }>;
      loadMcpStatus: (sessionId: string) => Promise<McpStatusResult>;
      importMcpConfig: (payload: { sessionId: string; sourcePath: string }) => Promise<{
        ok: boolean;
        imported?: string[];
        skipped?: string[];
        total_imported?: number;
        total_servers?: number;
        error?: string;
      }>;
      getMcpSettings: () => Promise<{
        ok: boolean;
        extra_search_paths?: string[];
        auto_connect?: string[];
        error?: string;
      }>;
      putMcpSettings: (payload: { extraSearchPaths: string[] }) => Promise<{
        ok: boolean;
        extra_search_paths?: string[];
        error?: string;
      }>;
      connectMcp: (payload: { sessionId: string; name: string }) => Promise<{ ok: boolean; error?: string }>;
      disconnectMcp: (payload: { sessionId: string; name: string }) => Promise<{ ok: boolean; error?: string }>;
      saveUserMode: (mode: "pro" | "lite") => Promise<{ ok: boolean }>;
      saveOnboardingCompleted: (completed: boolean) => Promise<{ ok: boolean }>;
      saveConfirmStrategy: (strategy: "manual" | "semi-auto" | "auto") => Promise<{ ok: boolean }>;
      saveEmailConfig: (payload: EmailConfig) => Promise<{ ok: boolean; error?: string }>;
      testEmailConfig: (payload: {
        config: EmailConfig;
        toEmail?: string;
      }) => Promise<{ ok: boolean; error?: string; message?: string }>;
      saveProvider: (payload: {
        name: string;
        apiKey?: string;
        baseUrl?: string;
        model?: string;
        models?: string[];
        enabled?: boolean;
        dropParams?: boolean;
      }) => Promise<{ ok: boolean }>;
      setDefaultProvider: (name: string) => Promise<{ ok: boolean }>;
      deleteProvider: (name: string) => Promise<{ ok: boolean }>;
      validateKey: (payload: {
        provider: string;
        apiKey: string;
        baseUrl?: string;
      }) => Promise<ValidateKeyResult>;
      fetchModels: (payload: {
        provider: string;
        apiKey: string;
        baseUrl?: string;
      }) => Promise<FetchModelsResult>;
      healthCheckModel: (payload: {
        provider: string;
        apiKey: string;
        baseUrl?: string;
        model: string;
      }) => Promise<HealthCheckResult>;

      saveConfig: (payload: {
        provider?: string;
        model?: string;
        apiKey?: string;
        activeProvider?: string;
        activeModel?: string;
      }) => Promise<{ ok: boolean; path: string }>;
      nativeSay: (text: string) => Promise<{ ok: boolean; reason?: string }>;

      loadSkills: () => Promise<SkillListResult>;
      loadSkillDetail: (args: { name: string }) => Promise<SkillDetailResult>;
      refreshSkills: () => Promise<SkillRefreshResult>;
      getSkillSettings: () => Promise<SkillSettingsResult>;
      putSkillSettings: (payload: {
        presetPaths: Array<{ id: string; enabled: boolean }>;
        customPaths: string[];
        preferredSources?: Record<string, string>;
        disabledSkills?: string[];
      }) => Promise<SkillSettingsResult>;

      loadBundles: () => Promise<BundleListResult>;
      installBundle: (args: {
        sourcePath: string;
        acknowledgeHighRisk?: boolean;
        confirmNonHighRisk?: boolean;
      }) => Promise<BundleInstallResult>;
      installBundlePreview: (args: { sourcePath: string }) => Promise<BundleInstallPreviewResult>;
      uninstallBundle: (args: { name: string }) => Promise<BundleUninstallResult>;

      searchRegistry: (args: { q: string }) => Promise<RegistrySearchResult>;
      searchSkillHub: (args: { q: string }) => Promise<SkillHubSearchResult>;
      loadLocalImageDataUrl: (path: string) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
      installFromRegistry: (args: {
        source: string;
        name: string;
        acknowledgeHighRisk?: boolean;
        confirmNonHighRisk?: boolean;
      }) => Promise<RegistryInstallResult>;
      installFromRegistryPreview: (args: { source: string; name: string }) => Promise<RegistryInstallPreviewResult>;

      terminalSpawn: (payload: {
        id: string;
        cwd: string;
        cols?: number;
        rows?: number;
      }) => Promise<{ ok: boolean; id?: string; error?: string }>;
      terminalBridgeAttach: (payload: {
        id: string;
        sessionId: string;
        baseUrl: string;
        token: string;
        cols?: number;
        rows?: number;
      }) => Promise<{ ok: boolean; id?: string; error?: string }>;
      terminalWrite: (payload: { id: string; data: string }) => Promise<{ ok: boolean }>;
      terminalWriteByTab: (payload: { tabId: string; data: string }) => Promise<{ ok: boolean; id?: string }>;
      terminalResize: (payload: { id: string; cols: number; rows: number }) => Promise<{ ok: boolean }>;
      terminalKill: (id: string) => Promise<{ ok: boolean }>;
      onTerminalData: (cb: (payload: { id: string; data: string }) => void) => () => void;
      onTerminalExit: (cb: (payload: { id: string }) => void) => () => void;
    };
  }
}
