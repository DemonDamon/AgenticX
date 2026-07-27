import { app, BrowserWindow, ipcMain, screen } from "electron";
import fs from "node:fs";
import path from "node:path";

export type SplashStage =
  | "initializing"
  | "backend-starting"
  | "backend-waiting"
  | "pinging-remote"
  | "loading-ui"
  | "preloading-core"
  | "restoring-session"
  | "ready";

export type StartupWindowBoundsInput = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isMaximized?: boolean;
};

const SPLASH_ANIMATION_TIMEOUT_MS = 9_000;
/** After backend is ready: allow preload + session restore before force-showing main window. */
const SPLASH_FORCE_SHOW_MS = 25_000;

let splashWindow: BrowserWindow | null = null;
let splashShownOnce = false;
let rendererReadyReceived = false;
let splashForceShowTimer: NodeJS.Timeout | null = null;
let splashAnimationCompleted = false;
let resolveSplashAnimation: (() => void) | null = null;

type LayoutThemeReader = () => "light" | "dark";

let readLayoutTheme: LayoutThemeReader = () => "dark";

export function configureSplashLayoutThemeReader(reader: LayoutThemeReader): void {
  readLayoutTheme = reader;
}

export function hasSplashBeenShown(): boolean {
  return splashShownOnce;
}

function resolveSplashHtmlPath(): string {
  const dev = path.join(process.cwd(), "electron", "splash.html");
  if (!app.isPackaged && fs.existsSync(dev)) return dev;
  const packaged = path.join(__dirname, "splash.html");
  if (fs.existsSync(packaged)) return packaged;
  return dev;
}

function resolveSplashPreloadPath(): string {
  const packaged = path.join(__dirname, "splash-preload.js");
  if (fs.existsSync(packaged)) return packaged;
  const dev = path.join(process.cwd(), "dist-electron", "splash-preload.js");
  if (fs.existsSync(dev)) return dev;
  return packaged;
}

function resolveSplashTheme(): "light" | "dark" {
  const theme = readLayoutTheme();
  return theme === "light" ? "light" : "dark";
}

export function resolveStartupWindowBounds(
  savedBounds: StartupWindowBoundsInput,
  options?: { forSplash?: boolean },
): { x: number; y: number; width: number; height: number } {
  const width =
    typeof savedBounds.width === "number" && savedBounds.width >= 680
      ? Math.floor(savedBounds.width)
      : 900;
  const height =
    typeof savedBounds.height === "number" && savedBounds.height >= 480
      ? Math.floor(savedBounds.height)
      : 700;
  const hasSavedPosition =
    typeof savedBounds.x === "number" &&
    typeof savedBounds.y === "number" &&
    Number.isFinite(savedBounds.x) &&
    Number.isFinite(savedBounds.y) &&
    savedBounds.x > -20_000 &&
    savedBounds.y > -20_000 &&
    savedBounds.x < 20_000 &&
    savedBounds.y < 20_000;
  const candidate = {
    x: hasSavedPosition ? Math.floor(savedBounds.x as number) : 0,
    y: hasSavedPosition ? Math.floor(savedBounds.y as number) : 0,
    width,
    height,
  };

  const hasVisibleIntersection = hasSavedPosition && screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const overlapWidth = Math.max(
      0,
      Math.min(candidate.x + candidate.width, area.x + area.width) - Math.max(candidate.x, area.x),
    );
    const overlapHeight = Math.max(
      0,
      Math.min(candidate.y + candidate.height, area.y + area.height) - Math.max(candidate.y, area.y),
    );
    return overlapWidth >= 120 && overlapHeight >= 80;
  });

  const display = hasVisibleIntersection
    ? screen.getDisplayMatching(candidate)
    : screen.getPrimaryDisplay();
  if (options?.forSplash && savedBounds.isMaximized) {
    return { ...display.workArea };
  }
  if (hasVisibleIntersection) return candidate;

  const area = display.workArea;
  return {
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + Math.max(20, (area.height - height) / 6)),
  };
}

function clearSplashTimers(): void {
  if (splashForceShowTimer) {
    clearTimeout(splashForceShowTimer);
    splashForceShowTimer = null;
  }
}

function destroySplashWindow(): void {
  clearSplashTimers();
  resolveSplashAnimation?.();
  resolveSplashAnimation = null;
  if (!splashWindow || splashWindow.isDestroyed()) {
    splashWindow = null;
    return;
  }
  splashWindow.destroy();
  splashWindow = null;
}

function markSplashAnimationComplete(): void {
  splashAnimationCompleted = true;
  resolveSplashAnimation?.();
  resolveSplashAnimation = null;
}

async function waitForSplashAnimation(): Promise<void> {
  if (splashAnimationCompleted) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (resolveSplashAnimation === finish) resolveSplashAnimation = null;
      resolve();
    };
    const timeout = setTimeout(finish, SPLASH_ANIMATION_TIMEOUT_MS);
    resolveSplashAnimation = finish;
  });
}

export function updateSplashStage(stage: SplashStage): void {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  splashWindow.webContents.send("splash:stage", stage);
}

export async function closeSplash(options?: { fade?: boolean }): Promise<void> {
  if (!splashWindow || splashWindow.isDestroyed()) {
    splashWindow = null;
    return;
  }
  const win = splashWindow;
  if (options?.fade !== false) {
    try {
      win.setAlwaysOnTop(true);
      win.webContents.send("splash:stage", "ready");
    } catch {
      // ignore
    }
    await waitForSplashAnimation();
  }
  destroySplashWindow();
}

export function registerSplashIpcHandlers(deps: {
  prepareMainWindowReveal: () => void;
  updateMainWindowReveal: (progress: number) => void;
  finishMainWindowReveal: () => void;
  quitApp: () => void;
}): void {
  ipcMain.handle("startup:renderer-ready", async () => {
    if (rendererReadyReceived) return { ok: true, duplicate: true };
    rendererReadyReceived = true;
    updateSplashStage("ready");
    deps.prepareMainWindowReveal();
    await closeSplash({ fade: true });
    deps.finishMainWindowReveal();
    return { ok: true };
  });

  ipcMain.handle("splash-request-quit", async () => {
    deps.quitApp();
    return { ok: true };
  });

  ipcMain.handle("splash-animation-complete", async (event) => {
    if (!splashWindow || splashWindow.isDestroyed() || event.sender !== splashWindow.webContents) {
      return { ok: false };
    }
    markSplashAnimationComplete();
    return { ok: true };
  });

  ipcMain.on("splash-reveal-main", (event, progress: unknown) => {
    if (!splashWindow || splashWindow.isDestroyed() || event.sender !== splashWindow.webContents) {
      return;
    }
    if (typeof progress !== "number" || !Number.isFinite(progress)) return;
    deps.updateMainWindowReveal(progress);
  });

  ipcMain.handle("update-splash-stage", async (_event, stage: SplashStage) => {
    updateSplashStage(stage);
    return { ok: true };
  });

  ipcMain.handle("get-splash-preload-enabled", async () => ({
    enabled: process.env.AGX_SPLASH_PRELOAD !== "0",
  }));
}

export function scheduleSplashForceShowFallback(showMainWindow: () => void): void {
  if (splashForceShowTimer) clearTimeout(splashForceShowTimer);
  splashForceShowTimer = setTimeout(() => {
    splashForceShowTimer = null;
    if (rendererReadyReceived) return;
    void (async () => {
      await closeSplash({ fade: false });
      showMainWindow();
    })();
  }, SPLASH_FORCE_SHOW_MS);
}

export function createSplashWindow(options?: { bounds?: { x: number; y: number; width: number; height: number } }): BrowserWindow | null {
  if (splashShownOnce) return null;
  splashShownOnce = true;
  rendererReadyReceived = false;
  splashAnimationCompleted = false;
  resolveSplashAnimation = null;

  const theme = resolveSplashTheme();

  splashWindow = new BrowserWindow({
    ...(options?.bounds ?? resolveStartupWindowBounds({}, { forSplash: true })),
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    webPreferences: {
      preload: resolveSplashPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  splashWindow.once("ready-to-show", () => {
    splashWindow?.show();
    updateSplashStage("initializing");
  });

  const htmlPath = resolveSplashHtmlPath();
  const query: Record<string, string> = {
    theme,
  };

  if (fs.existsSync(htmlPath)) {
    void splashWindow.loadFile(htmlPath, { query }).catch((err) => {
      console.warn("[splash] loadFile failed:", err);
      destroySplashWindow();
    });
  } else {
    console.warn("[splash] splash.html not found at", htmlPath);
    destroySplashWindow();
  }

  return splashWindow;
}

export function onMainWindowDidFinishLoad(): void {
  updateSplashStage("restoring-session");
}
