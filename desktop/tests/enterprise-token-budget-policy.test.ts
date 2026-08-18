import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const desktopRoot = fileURLToPath(new URL("../", import.meta.url));
const readDesktopSource = (relativePath: string) =>
  fs.readFileSync(path.resolve(desktopRoot, relativePath), "utf8");

describe("enterprise-managed Desktop token budget contract", () => {
  it("persists bootstrap policy on login and refresh without overwriting local runtime limits", () => {
    const main = readDesktopSource("electron/main.ts");
    const applyStart = main.indexOf("function applyEnterpriseProvider(");
    const applyEnd = main.indexOf("function managedEnterpriseProviderId", applyStart);
    const applyProvider = main.slice(applyStart, applyEnd);

    expect(applyProvider).toContain("token_budget: normalizeEnterpriseTokenBudgetPolicy(opts.tokenBudget)");
    expect(applyProvider).not.toContain("runtime.token_budget");
    expect(main.match(/tokenBudget: bootJson\.data\?\.policy\?\.tokenBudget/g)).toHaveLength(2);
  });

  it("reports effective managed values only while enterprise authentication is active", () => {
    const main = readDesktopSource("electron/main.ts");
    const start = main.indexOf("const readEffectiveTokenBudget = (");
    const end = main.indexOf('ipcMain.handle("load-runtime-config"', start);
    const resolver = main.slice(start, end);

    expect(resolver).toContain("cfg.enterprise?.enabled && cfg.enterprise?.token");
    expect(resolver).toContain("token_budget_managed: false");
    expect(resolver).toContain("cfg.enterprise?.policy?.token_budget");
    expect(resolver).toContain("token_budget_managed: true");
  });

  it("rejects managed alert-only saves and never mutates managed alert thresholds", () => {
    const main = readDesktopSource("electron/main.ts");
    const start = main.indexOf('ipcMain.handle("save-runtime-config"');
    const end = main.indexOf('ipcMain.handle("load-appearance-config"', start);
    const saveHandler = main.slice(start, end);

    expect(saveHandler).toContain("tokenBudgetManaged && managedTokenFieldsRequested && !hasNonManagedTokenFields");
    expect(saveHandler).toContain('error: "会话 Token 提醒阈值由组织统一管理"');
    expect(saveHandler).toContain("!tokenBudgetManaged");
    expect(saveHandler).not.toContain(["policy", "version"].join("_"));
    expect(saveHandler).not.toMatch(new RegExp(["migra", "t"].join(""), "i"));
  });

  it("wires the managed flag through IPC types and renders a read-only managed form", () => {
    const preload = readDesktopSource("electron/preload.ts");
    const globalTypes = readDesktopSource("src/global.d.ts");
    const panel = readDesktopSource("src/components/settings/DeveloperTokenBudgetPanel.tsx");

    expect(preload).toContain("warning_tokens_per_session?: number");
    expect(globalTypes).toContain("token_budget_managed?: boolean");
    expect(panel).toContain("setManaged(result.token_budget_managed === true)");
    expect(panel.match(/disabled=\{loading \|\| saving \|\| managed\}/g)).toHaveLength(2);
    expect(panel).toContain("当前数值由组织统一管理，登录企业账号期间不可在本机修改。");
    expect(panel).toContain('{managed ? "组织统一管理"');
    expect(panel).toContain("两级提醒都不会中断任务或阻止后续对话");
    expect(panel).not.toContain("停止阈值");
  });

  it("contains no historical token-budget conversion contract", () => {
    const files = [
      "electron/main.ts",
      "electron/preload.ts",
      "src/global.d.ts",
      "src/components/settings/DeveloperTokenBudgetPanel.tsx",
    ];
    const source = files.map(readDesktopSource).join("\n");

    expect(source).not.toContain(["policy", "version"].join("_"));
    expect(source).not.toContain(
      ["needs", "policy", ["migra", "tion"].join("")].join("_"),
    );
  });
});
