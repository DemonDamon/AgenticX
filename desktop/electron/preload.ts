import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("agenticxDesktop", {
  version: "0.2.0",
  getApiBase: async (): Promise<string> => ipcRenderer.invoke("get-api-base"),
  getApiAuthToken: async (): Promise<string> => ipcRenderer.invoke("get-api-auth-token"),
  platform: async (): Promise<string> => ipcRenderer.invoke("get-platform"),
  onOpenSettings: (cb: () => void): void => {
    ipcRenderer.on("open-settings", () => cb());
  },

  loadConfig: async () => ipcRenderer.invoke("load-config"),
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
  saveConfig: async (payload: { provider?: string; model?: string; apiKey?: string }) =>
    ipcRenderer.invoke("save-config", payload),
  nativeSay: async (text: string) => ipcRenderer.invoke("native-say", text),
});
