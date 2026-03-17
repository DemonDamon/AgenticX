import { contextBridge, ipcRenderer } from "electron";

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
  version: "0.2.0",
  getApiBase: async (): Promise<string> => ipcRenderer.invoke("get-api-base"),
  getApiAuthToken: async (): Promise<string> => ipcRenderer.invoke("get-api-auth-token"),
  platform: async (): Promise<string> => ipcRenderer.invoke("get-platform"),
  onOpenSettings: (cb: () => void): void => {
    ipcRenderer.on("open-settings", () => cb());
  },

  listAvatars: async () => ipcRenderer.invoke("list-avatars"),
  createAvatar: async (payload: { name: string; role?: string; avatar_url?: string; system_prompt?: string; created_by?: string }) =>
    ipcRenderer.invoke("create-avatar", payload),
  updateAvatar: async (payload: { id: string; name?: string; role?: string; avatar_url?: string; pinned?: boolean; system_prompt?: string }) =>
    ipcRenderer.invoke("update-avatar", payload),
  deleteAvatar: async (id: string) => ipcRenderer.invoke("delete-avatar", id),

  listSessions: async (avatarId?: string) => ipcRenderer.invoke("list-sessions", avatarId),
  createSession: async (payload: { avatar_id?: string; name?: string; inherit_from_session_id?: string }) =>
    ipcRenderer.invoke("create-session", payload),
  renameSession: async (payload: { sessionId: string; name: string }) =>
    ipcRenderer.invoke("rename-session", payload),
  deleteSession: async (sessionId: string) =>
    ipcRenderer.invoke("delete-session", sessionId),
  deleteSessionsBatch: async (sessionIds: string[]) =>
    ipcRenderer.invoke("delete-sessions-batch", sessionIds),
  pinSession: async (payload: { sessionId: string; pinned: boolean }) =>
    ipcRenderer.invoke("pin-session", payload),
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
  loadEmailConfig: async () => ipcRenderer.invoke("load-email-config"),
  loadMcpStatus: async (sessionId: string) => ipcRenderer.invoke("load-mcp-status", sessionId),
  importMcpConfig: async (payload: { sessionId: string; sourcePath: string }) =>
    ipcRenderer.invoke("import-mcp-config", payload),
  connectMcp: async (payload: { sessionId: string; name: string }) =>
    ipcRenderer.invoke("connect-mcp", payload),
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
});
