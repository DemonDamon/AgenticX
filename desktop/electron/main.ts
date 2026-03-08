import { app, BrowserWindow, Menu, Tray } from "electron";
import path from "node:path";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 720,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";
  void mainWindow.loadURL(devUrl);
}

function createTray(): void {
  tray = new Tray(path.join(__dirname, "trayTemplate.png"));
  const menu = Menu.buildFromTemplate([
    { label: "打开侧边栏", click: () => mainWindow?.show() },
    { label: "设置", click: () => mainWindow?.webContents.send("open-settings") },
    { type: "separator" },
    { label: "退出", click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip("AgenticX Desktop");
}

app.whenReady().then(() => {
  createWindow();
  createTray();
});
