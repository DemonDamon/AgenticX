import { BrowserWindow, dialog, ipcMain, nativeImage } from "electron";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { AppearanceStore } from "./chat-appearance-store";
import { MAX_IMAGE_BYTES, MAX_PACKAGE_BYTES } from "./chat-appearance-contract";

export function registerChatAppearanceIpc(configDir: string, getWindow: () => BrowserWindow | null): void {
  const store = new AppearanceStore(configDir, { decodeImage: bytes => {
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) throw Error("壁纸图片无法解码");
    return image.getSize();
  } });
  const open = (options: Electron.OpenDialogOptions) => {
    const win = getWindow();
    return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
  };
  ipcMain.handle("appearance-load", () => store.load());
  ipcMain.handle("appearance-save", (_event, payload: unknown) => store.save(payload));
  ipcMain.handle("appearance-read-wallpaper", (_event, assetId: unknown) => store.readWallpaper(assetId));
  ipcMain.handle("appearance-import-wallpaper", async () => {
    try {
      const result = await open({ title: "选择聊天壁纸", properties: ["openFile"], filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }] });
      if (result.canceled || !result.filePaths[0]) return { ok: true, value: null };
      const file = result.filePaths[0];
      if (statSync(file).size > MAX_IMAGE_BYTES) throw Error("壁纸大小必须不超过 10 MiB");
      return store.importWallpaper(readFileSync(file));
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle("appearance-import-package", async () => {
    try {
      const result = await open({ title: "导入聊天主题", properties: ["openFile"], filters: [{ name: "聊天主题", extensions: ["json"] }] });
      if (result.canceled || !result.filePaths[0]) return { ok: true, value: null };
      const file = result.filePaths[0];
      if (statSync(file).size > MAX_PACKAGE_BYTES) throw Error("主题包大小必须不超过 20 MiB");
      return store.importPackage(readFileSync(file));
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle("appearance-export-package", async (_event, payload: unknown) => {
    try {
      const exported = store.exportPackage(payload);
      if (!exported.ok) return exported;
      const options: Electron.SaveDialogOptions = { title: "导出聊天主题", defaultPath: "chat-theme.near-theme.json", filters: [{ name: "聊天主题", extensions: ["json"] }] };
      const win = getWindow(); const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (!result.canceled && result.filePath) writeFileSync(result.filePath, JSON.stringify(exported.value), { mode: 0o600 });
      return { ok: true, value: null };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  });
}
