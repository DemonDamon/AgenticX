import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("agenticxDesktop", {
  version: "0.1.0",
  getApiBase: async (): Promise<string> => ipcRenderer.invoke("get-api-base"),
  getApiAuthToken: async (): Promise<string> => ipcRenderer.invoke("get-api-auth-token"),
  platform: async (): Promise<string> => ipcRenderer.invoke("get-platform"),
  onOpenSettings: (cb: () => void): void => {
    ipcRenderer.on("open-settings", () => cb());
  },
  saveConfig: async (payload: { provider?: string; model?: string; apiKey?: string }) =>
    ipcRenderer.invoke("save-config", payload),
  nativeSay: async (text: string) => ipcRenderer.invoke("native-say", text)
});
