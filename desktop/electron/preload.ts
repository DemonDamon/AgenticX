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
