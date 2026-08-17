import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readDesktopSource = (relativePath: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

describe("Tencent Meeting connector cancellation contract", () => {
  it("wires a cancel IPC method across main, preload, and renderer types", () => {
    const main = readDesktopSource("electron/main.ts");
    const preload = readDesktopSource("electron/preload.ts");
    const globalTypes = readDesktopSource("src/global.d.ts");

    expect(main).toContain('ipcMain.handle("native-connector-tmeet-cancel"');
    expect(preload).toContain('nativeConnectorTmeetCancel: async () =>');
    expect(preload).toContain('ipcRenderer.invoke("native-connector-tmeet-cancel")');
    expect(globalTypes).toContain("nativeConnectorTmeetCancel: () => Promise<{");
  });

  it("settles cancellation and cannot spawn auth after a cancelled install", () => {
    const main = readDesktopSource("electron/main.ts");
    const start = main.indexOf("function startTmeetLogin()");
    const end = main.indexOf("const GH_CLI_VERSION", start);
    const loginFlow = main.slice(start, end);

    expect(loginFlow).toContain("cancelActiveTmeetLogin = async (reason) =>");
    expect(loginFlow).toMatch(
      /ensureTmeetBinaryInstalled\(\)\.then\(\(binaryPath\) => \{[\s\S]*?if \(settled\) return;[\s\S]*?proc = spawn/,
    );
  });

  it("keeps both the modal close action and Cancel button usable while busy", () => {
    const source = readDesktopSource("src/components/settings/connectors/ConnectorsTab.tsx");
    const start = source.indexOf('open={selected?.id === "tencent-meeting"}');
    const end = source.indexOf('open={selected?.id === "github"}', start);
    const modal = source.slice(start, end);
    const cancelClick = modal.indexOf("onClick={() => void handleTmeetCancel()}");
    const cancelButtonStart = modal.lastIndexOf("<button", cancelClick);
    const cancelButtonEnd = modal.indexOf("</button>", cancelClick);
    const cancelButton = modal.slice(cancelButtonStart, cancelButtonEnd);

    expect(modal).toContain("onClose={() => void handleTmeetCancel()}");
    expect(modal).toContain("onClick={() => void handleTmeetCancel()}");
    expect(cancelButton).not.toContain("disabled=");
  });
});
