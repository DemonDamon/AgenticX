import { app, BrowserWindow, ipcMain, screen, type BrowserWindowConstructorOptions } from "electron";
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

/** Long enough for the splash to wash into the app background colour. */
const SPLASH_FADE_MS = 380;
/** After backend is ready: allow preload + session restore before force-showing main window. */
const SPLASH_FORCE_SHOW_MS = 25_000;

let splashWindow: BrowserWindow | null = null;
let splashShownOnce = false;
let rendererReadyReceived = false;
let splashForceShowTimer: NodeJS.Timeout | null = null;

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

/** Splash is a regular window — do not pin it above other apps during cold start. */
export function buildSplashWindowLayerOptions(): Pick<
  BrowserWindowConstructorOptions,
  "alwaysOnTop"
> {
  return { alwaysOnTop: false };
}

export type SplashMouseIgnoreState = {
  fading?: boolean;
  captureClicks?: boolean;
};

/** Glass splash is visual-only: forward clicks so the app underneath can come forward. */
export function buildSplashMouseIgnoreOptions(
  state: SplashMouseIgnoreState = {},
): { ignore: boolean; forward?: boolean } {
  if (state.captureClicks) {
    return { ignore: false };
  }
  return { ignore: true, forward: true };
}

function applySplashMouseIgnore(
  win: BrowserWindow,
  state: SplashMouseIgnoreState = {},
): void {
  const options = buildSplashMouseIgnoreOptions(state);
  try {
    if (options.ignore) {
      win.setIgnoreMouseEvents(true, options.forward ? { forward: true } : undefined);
    } else {
      win.setIgnoreMouseEvents(false);
    }
  } catch {
    try {
      win.setIgnoreMouseEvents(options.ignore);
    } catch {
      // ignore
    }
  }
}

export function focusSplashIfOpen(): boolean {
  if (!splashWindow || splashWindow.isDestroyed()) return false;
  if (splashWindow.isMinimized()) splashWindow.restore();
  splashWindow.show();
  splashWindow.focus();
  return true;
}

function splashGlassOptions(theme: "light" | "dark"): BrowserWindowConstructorOptions {
  const glass: BrowserWindowConstructorOptions = {
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: true,
    roundedCorners: true,
  };
  if (process.platform === "darwin") {
    return {
      ...glass,
      vibrancy: theme === "light" ? "popover" : "under-window",
      visualEffectState: "active",
    };
  }
  if (process.platform === "win32") {
    return {
      ...glass,
      backgroundMaterial: "acrylic",
    };
  }
  return glass;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function centerSplashBounds(): { x: number; y: number; width: number; height: number } {
  const { workArea } = screen.getPrimaryDisplay();
  // Pixel Drift wordmark needs a wider stage than the old 620x360 card.
  const availableWidth = Math.max(480, workArea.width - 48);
  const availableHeight = Math.max(360, workArea.height - 48);
  const targetWidth = clamp(Math.round(workArea.width * 0.48), 800, 960);
  const width = Math.min(targetWidth, availableWidth);
  const targetHeight = clamp(Math.round(width * 0.58), 500, 600);
  const height = Math.min(targetHeight, availableHeight);
  return {
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
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
  if (!splashWindow || splashWindow.isDestroyed()) {
    splashWindow = null;
    return;
  }
  splashWindow.destroy();
  splashWindow = null;
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
      win.webContents.send("splash:stage", "ready");
    } catch {
      // ignore
    }
    applySplashMouseIgnore(win, { fading: true });
    await new Promise((resolve) => setTimeout(resolve, SPLASH_FADE_MS));
  }
  destroySplashWindow();
}

export function registerSplashIpcHandlers(deps: {
  showMainWindow: () => void;
  quitApp: () => void;
}): void {
  ipcMain.handle("startup:renderer-ready", async () => {
    if (rendererReadyReceived) return { ok: true, duplicate: true };
    rendererReadyReceived = true;
    updateSplashStage("ready");
    deps.showMainWindow();
    await closeSplash({ fade: true });
    return { ok: true };
  });

  ipcMain.handle("splash-request-quit", async () => {
    deps.quitApp();
    return { ok: true };
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
      showMainWindow();
      await closeSplash({ fade: false });
    })();
  }, SPLASH_FORCE_SHOW_MS);
}

export function createSplashWindow(): BrowserWindow | null {
  if (splashShownOnce) return null;
  splashShownOnce = true;
  rendererReadyReceived = false;

  const theme = resolveSplashTheme();

  splashWindow = new BrowserWindow({
    ...centerSplashBounds(),
    ...splashGlassOptions(theme),
    ...buildSplashWindowLayerOptions(),
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    focusable: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: resolveSplashPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  splashWindow.once("ready-to-show", () => {
    splashWindow?.setAlwaysOnTop(false);
    splashWindow?.show();
    if (splashWindow && !splashWindow.isDestroyed()) {
      applySplashMouseIgnore(splashWindow);
    }
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
