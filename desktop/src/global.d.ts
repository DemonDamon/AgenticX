export {};

type ProviderConfig = {
  api_key?: string;
  base_url?: string;
  model?: string;
  models?: string[];
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
type AvatarItem = {
  id: string;
  name: string;
  role?: string;
  avatar_url?: string;
  pinned?: boolean;
  created_by?: string;
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
  name: string;
  description: string;
  location: string;
  base_dir: string;
};
type SkillListResult = { ok: boolean; items: SkillItem[]; count: number; error?: string };
type SkillDetailResult = {
  ok: boolean;
  name: string;
  description: string;
  location: string;
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
type RegistryInstallResult = { ok: boolean; name?: string; installed_path?: string; error?: string };

declare global {
  interface Window {
    agenticxDesktop: {
      version: string;
      getApiBase: () => Promise<string>;
      getApiAuthToken: () => Promise<string>;
      platform: () => Promise<string>;
      onOpenSettings: (cb: () => void) => void;

      listAvatars: () => Promise<{ ok: boolean; avatars: AvatarItem[] }>;
      createAvatar: (payload: { name: string; role?: string; avatar_url?: string; system_prompt?: string; created_by?: string }) => Promise<{ ok: boolean; avatar?: AvatarItem; error?: string }>;
      updateAvatar: (payload: { id: string; name?: string; role?: string; avatar_url?: string; pinned?: boolean; system_prompt?: string }) => Promise<{ ok: boolean; avatar?: AvatarItem; error?: string }>;
      deleteAvatar: (id: string) => Promise<{ ok: boolean; error?: string }>;

      listSessions: (avatarId?: string) => Promise<{ ok: boolean; sessions: Array<{ session_id: string; avatar_id: string | null; avatar_name?: string | null; session_name: string | null; updated_at: number; created_at?: number; pinned?: boolean; archived?: boolean }> }>;
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
      connectMcp: (payload: { sessionId: string; name: string }) => Promise<{ ok: boolean; error?: string }>;
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

      loadBundles: () => Promise<BundleListResult>;
      installBundle: (args: { sourcePath: string }) => Promise<BundleInstallResult>;
      uninstallBundle: (args: { name: string }) => Promise<BundleUninstallResult>;

      searchRegistry: (args: { q: string }) => Promise<RegistrySearchResult>;
      installFromRegistry: (args: { source: string; name: string }) => Promise<RegistryInstallResult>;
    };
  }
}
