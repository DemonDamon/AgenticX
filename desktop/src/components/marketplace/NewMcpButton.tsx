/**
 * 插件市场 MCP 页「+ 新建 MCP」主按钮 + 下拉（与「新建连接器」同款样式）：
 * - 远程 MCP（URL）：复用设置页 McpRemoteServerModal（新增时同名 / 同端点 + 同凭证去重，不打连接器标）；
 * - 本地命令（stdio）：复用 MCPJsonEditorModal 编辑 mcp.json 添加 command / args。
 * 通用 MCP Server 不是连接器：只出现在 MCP 页（已添加 / 管理），不进「我的连接」。
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Globe, Plus, SquareTerminal } from "lucide-react";
import { McpRemoteServerModal } from "../settings/mcp/McpRemoteServerModal";
import { MCPJsonEditorModal } from "../settings/mcp/MCPJsonEditorModal";
import { MCP_PRIMARY_CONFIG_PATH } from "../../utils/mcp-remote-config";

/** 下拉菜单项（顺序即展示顺序）。 */
export const NEW_MCP_MENU_ITEMS = ["remote", "local"] as const;
export type NewMcpMenuItem = (typeof NEW_MCP_MENU_ITEMS)[number];

type Props = {
  /** 保存成功：宿主刷新 MCP 状态并提示。 */
  onChanged: (message: string) => void | Promise<void>;
  configPath?: string;
  className?: string;
};

export function NewMcpButton({ onChanged, configPath = MCP_PRIMARY_CONFIG_PATH, className = "" }: Props) {
  const { t } = useTranslation("marketplace");
  const [menuOpen, setMenuOpen] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonPath, setJsonPath] = useState(configPath);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const menuItem =
    "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-strong transition hover:bg-surface-hover";

  return (
    <div ref={wrapRef} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md bg-btnPrimary px-3 py-1.5 text-[13px] font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        data-new-mcp-button
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {t("mcpNew.button")}
        <ChevronDown className={`h-3 w-3 opacity-80 transition ${menuOpen ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {menuOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1.5 w-60 rounded-xl border border-border bg-surface-popover p-1 shadow-xl"
        >
          {NEW_MCP_MENU_ITEMS.map((item) => {
            const Icon = item === "remote" ? Globe : SquareTerminal;
            return (
              <button
                key={item}
                type="button"
                role="menuitem"
                className={menuItem}
                data-new-mcp-item={item}
                onClick={() => {
                  setMenuOpen(false);
                  if (item === "remote") setRemoteOpen(true);
                  else {
                    setJsonPath(configPath);
                    setJsonOpen(true);
                  }
                }}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden />
                <span className="flex min-w-0 flex-col">
                  <span>{t(`mcpNew.${item}`)}</span>
                  <span className="text-[11px] text-text-faint">{t(`mcpNew.${item}Hint`)}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      <McpRemoteServerModal
        open={remoteOpen}
        mode="add"
        configPath={configPath}
        onClose={() => setRemoteOpen(false)}
        onSaved={async (message) => {
          await onChanged(message);
        }}
      />
      <MCPJsonEditorModal
        open={jsonOpen}
        selectedPath={jsonPath}
        filePaths={[configPath]}
        onClose={() => setJsonOpen(false)}
        onPickPath={setJsonPath}
        onLoad={async (path) => {
          const result = await window.agenticxDesktop.mcpGetRaw({ path });
          if (!result.ok) return { ok: false, error: result.error };
          return { ok: true, text: result.text, format: result.format, parse_error: result.parse_error };
        }}
        onSave={async (path, text) => {
          const result = await window.agenticxDesktop.mcpPutRaw({ path, text });
          if (!result.ok) return { ok: false, error: result.error };
          await onChanged(t("mcpNew.savedJson"));
          return { ok: true };
        }}
      />
    </div>
  );
}
