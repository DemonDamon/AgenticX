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
  revealMain: (progress: number): void => ipcRenderer.send("splash-reveal-main", progress),
  animationComplete: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("splash-animation-complete"),
  onStage: (callback: (stage: SplashStage) => void): (() => void) => {
    const handler = (_event: unknown, stage: SplashStage) => callback(stage);
    ipcRenderer.on("splash:stage", handler);
    return () => ipcRenderer.removeListener("splash:stage", handler);
  },
});
