import { contextBridge, ipcRenderer } from "electron";

type SplashStage =
  | "initializing"
  | "backend-starting"
  | "backend-waiting"
  | "pinging-remote"
  | "loading-ui"
  | "preloading-core"
  | "restoring-session"
  | "ready";

contextBridge.exposeInMainWorld("nearSplash", {
  requestQuit: (): Promise<void> => ipcRenderer.invoke("splash-request-quit"),
  onStage: (callback: (stage: SplashStage) => void): (() => void) => {
    const handler = (_event: unknown, stage: SplashStage) => callback(stage);
    ipcRenderer.on("splash:stage", handler);
    return () => ipcRenderer.removeListener("splash:stage", handler);
  },
});
