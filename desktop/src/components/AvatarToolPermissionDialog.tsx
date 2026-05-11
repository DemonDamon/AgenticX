import { useEffect, useMemo, useState } from "react";

type PermissionDialogMode = "avatar" | "machi-global";

type ToolItem = {
  id: string;
  name: string;
  description: string;
};

const DEFAULT_TOOLS: ToolItem[] = [
  { id: "liteparse", name: "LiteParse", description: "轻量 PDF/Office 文档解析" },
  { id: "mineru", name: "MinerU", description: "深度文档解析" },
  { id: "libreoffice", name: "LibreOffice", description: "Office 格式转换依赖" },
  { id: "imagemagick", name: "ImageMagick", description: "图像转换依赖" },
];

type Props = {
  open: boolean;
  mode: PermissionDialogMode;
  title: string;
  initialToolsEnabled: Record<string, boolean>;
  onClose: () => void;
  onSave: (toolsEnabled: Record<string, boolean>) => Promise<void>;
};

export function AvatarToolPermissionDialog({
  open,
  mode,
  title,
  initialToolsEnabled,
  onClose,
  onSave,
}: Props) {
  const [tools, setTools] = useState<ToolItem[]>(DEFAULT_TOOLS);
  const [toolsEnabled, setToolsEnabled] = useState<Record<string, boolean>>({});
  const [loadingTools, setLoadingTools] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setToolsEnabled({ ...initialToolsEnabled });
    setError("");
  }, [open, initialToolsEnabled]);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    setLoadingTools(true);
    void (async () => {
      try {
        const result = await window.agenticxDesktop.getToolsStatus();
        if (!disposed && result?.ok && Array.isArray(result.tools) && result.tools.length > 0) {
          setTools(
            result.tools.map((item) => ({
              id: String(item.id),
              name: String(item.name),
              description: String(item.description || ""),
            }))
          );
        }
      } finally {
        if (!disposed) setLoadingTools(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [open]);

  const customizedCount = useMemo(
    () => Object.keys(toolsEnabled).filter((key) => toolsEnabled[key] !== undefined).length,
    [toolsEnabled]
  );

  const modeHint =
    mode === "avatar"
      ? "未设置项继承 Machi 全局策略；如全局未设置，则默认启用。"
      : "Machi 全局策略将作为所有分身默认值；未设置项默认启用。";

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="w-[520px] max-w-[96vw] rounded-xl border border-border bg-surface-panel p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[16px] font-semibold text-text-primary">{title}</h3>
        <p className="mt-1 text-xs text-text-faint">
          {customizedCount > 0 ? `已自定义 ${customizedCount} 项` : "未自定义（使用默认）"} · {modeHint}
        </p>

        {loadingTools ? (
          <div className="mt-3 rounded-md border border-border bg-surface-card px-3 py-2 text-xs text-text-faint">
            加载工具列表中...
          </div>
        ) : null}

        <div className="mt-3 max-h-[52vh] space-y-2 overflow-y-auto pr-1">
          {tools.map((tool) => {
            const inherited = !(tool.id in toolsEnabled);
            const enabled = inherited ? true : Boolean(toolsEnabled[tool.id]);
            const stateLabel = inherited ? "默认" : enabled ? "启用" : "禁用";
            return (
              <div key={tool.id} className="rounded-md border border-border bg-surface-card px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-text-primary">{tool.name}</div>
                    <div className="truncate text-xs text-text-faint">{tool.description}</div>
                  </div>
                  <button
                    type="button"
                    className={`inline-flex min-w-[72px] items-center justify-center rounded border px-2 py-0.5 text-xs transition ${
                      inherited
                        ? "border-border text-text-faint"
                        : enabled
                          ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-400"
                          : "border-border-strong bg-surface-hover text-text-muted"
                    }`}
                    onClick={() => {
                      setToolsEnabled((prev) => {
                        const next = { ...prev };
                        if (!(tool.id in next)) {
                          next[tool.id] = false;
                        } else if (next[tool.id] === false) {
                          delete next[tool.id];
                        } else {
                          next[tool.id] = false;
                        }
                        return next;
                      });
                    }}
                  >
                    {stateLabel}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {error ? (
          <div className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-300">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            className="rounded border border-border px-2.5 py-1 text-xs text-text-subtle transition hover:bg-surface-hover disabled:opacity-40"
            onClick={() => setToolsEnabled({})}
            disabled={customizedCount === 0 || saving}
          >
            重置默认
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover"
              onClick={onClose}
              disabled={saving}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-md bg-btnPrimary px-3 py-1.5 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-40"
              disabled={saving}
              onClick={() => {
                setSaving(true);
                setError("");
                void (async () => {
                  try {
                    await onSave({ ...toolsEnabled });
                    onClose();
                  } catch (err) {
                    setError(String(err));
                  } finally {
                    setSaving(false);
                  }
                })();
              }}
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
