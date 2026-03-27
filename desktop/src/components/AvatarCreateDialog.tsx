import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreate: (data: {
    name: string;
    role: string;
    systemPrompt: string;
    toolsEnabled: Record<string, boolean>;
  }) => Promise<void>;
};

type Mode = "manual" | "ai";
type ToolItem = { id: string; name: string; description: string };

const DEFAULT_TOOLS: ToolItem[] = [
  { id: "liteparse", name: "LiteParse", description: "轻量 PDF/Office 文档解析" },
  { id: "mineru", name: "MinerU", description: "深度文档解析" },
  { id: "libreoffice", name: "LibreOffice", description: "Office 格式转换依赖" },
  { id: "imagemagick", name: "ImageMagick", description: "图像转换依赖" },
];

export function AvatarCreateDialog({ open, onClose, onCreate }: Props) {
  const [mode, setMode] = useState<Mode>("manual");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [tools, setTools] = useState<ToolItem[]>(DEFAULT_TOOLS);
  const [toolsEnabled, setToolsEnabled] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    let disposed = false;
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
      } catch {
        // Keep default tools when loading status fails.
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

  if (!open) return null;

  const handleCreate = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onCreate({
        name: name.trim(),
        role: role.trim(),
        systemPrompt: systemPrompt.trim(),
        toolsEnabled: { ...toolsEnabled },
      });
      setName("");
      setRole("");
      setSystemPrompt("");
      setToolsEnabled({});
      setToolsOpen(false);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleAiGenerate = async () => {
    if (!description.trim()) return;
    setBusy(true);
    setAiError("");
    try {
      const result = await window.agenticxDesktop.generateAvatar({ description: description.trim() });
      if (result.ok) {
        setDescription("");
        onClose();
      } else {
        setAiError(result.error || "AI 生成失败");
      }
    } catch (err) {
      setAiError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const resetAndClose = () => {
    setName("");
    setRole("");
    setSystemPrompt("");
    setDescription("");
    setAiError("");
    setToolsEnabled({});
    setToolsOpen(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-[440px] max-w-[95vw] rounded-xl border border-border bg-surface-panel p-5">
        <h3 className="mb-4 text-base font-semibold text-text-primary">创建数字分身</h3>

        <div className="mb-4 flex gap-1 rounded-lg bg-surface-card p-0.5">
          {([["manual", "手动创建"], ["ai", "AI 生成"]] as const).map(([key, label]) => (
            <button
              key={key}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                mode === key
                  ? "bg-cyan-500/20 text-cyan-400"
                  : "text-text-subtle hover:text-text-primary"
              }`}
              onClick={() => setMode(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "manual" ? (
          <>
            <div className="space-y-3">
              <label className="block text-sm text-text-muted">
                名称 <span className="text-rose-400">*</span>
                <input
                  className="mt-1 w-full rounded-md border border-border bg-surface-panel px-3 py-2 text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例：Coder、Researcher、Writer"
                  autoFocus
                />
              </label>
              <label className="block text-sm text-text-muted">
                角色
                <input
                  className="mt-1 w-full rounded-md border border-border bg-surface-panel px-3 py-2 text-sm"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="例：全栈开发工程师、数据分析师"
                />
              </label>
              <label className="block text-sm text-text-muted">
                System Prompt
                <span className="ml-1 text-xs text-text-faint">(可选)</span>
                <textarea
                  className="mt-1 w-full resize-none rounded-md border border-border bg-surface-panel px-3 py-2 text-sm"
                  rows={3}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="自定义角色行为指令..."
                />
              </label>

              <div className="rounded-md border border-border bg-surface-card">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-text-muted transition hover:bg-surface-hover"
                  onClick={() => setToolsOpen((prev) => !prev)}
                >
                  <span>
                    工具权限（{customizedCount > 0 ? `已自定义 ${customizedCount} 项` : "继承全局默认"}）
                  </span>
                  {toolsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>

                {toolsOpen && (
                  <div className="space-y-2 border-t border-border px-3 py-3">
                    {tools.map((tool) => {
                      const inherited = !(tool.id in toolsEnabled);
                      const enabled = inherited ? false : Boolean(toolsEnabled[tool.id]);
                      return (
                        <div
                          key={tool.id}
                          className="rounded-md border border-border bg-surface-panel px-2.5 py-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm text-text-primary">{tool.name}</div>
                              <div className="truncate text-xs text-text-faint">{tool.description}</div>
                            </div>
                            <button
                              type="button"
                              className={`inline-flex min-w-[70px] items-center justify-center rounded border px-2 py-0.5 text-xs transition ${
                                inherited
                                  ? "border-border text-text-faint"
                                  : enabled
                                    ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-400"
                                    : "border-border-strong bg-surface-hover text-text-muted"
                              }`}
                              onClick={() => {
                                setToolsEnabled((prev) => {
                                  const next = { ...prev };
                                  if (!(tool.id in next)) next[tool.id] = true;
                                  else next[tool.id] = !next[tool.id];
                                  return next;
                                });
                              }}
                            >
                              {inherited ? "继承" : enabled ? "启用" : "禁用"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex justify-end">
                      <button
                        type="button"
                        className="rounded border border-border px-2.5 py-1 text-xs text-text-subtle transition hover:bg-surface-hover"
                        onClick={() => setToolsEnabled({})}
                        disabled={customizedCount === 0}
                      >
                        重置为全局默认
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                className="rounded-md border border-border px-4 py-1.5 text-sm text-text-subtle transition hover:bg-surface-hover"
                onClick={resetAndClose}
              >
                取消
              </button>
              <button
                className="rounded-md bg-btnPrimary px-4 py-1.5 text-sm font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-40"
                disabled={busy || !name.trim()}
                onClick={handleCreate}
              >
                {busy ? "创建中..." : "创建"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-3">
              <label className="block text-sm text-text-muted">
                描述你想要的分身
                <textarea
                  className="mt-1 w-full resize-none rounded-md border border-border bg-surface-panel px-3 py-2 text-sm"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="描述分身的能力、性格和专长，AI 将自动生成名称、角色和 System Prompt..."
                  autoFocus
                />
              </label>
              {aiError && (
                <div className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
                  {aiError}
                </div>
              )}
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                className="rounded-md border border-border px-4 py-1.5 text-sm text-text-subtle transition hover:bg-surface-hover"
                onClick={resetAndClose}
              >
                取消
              </button>
              <button
                className="rounded-md bg-violet-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-violet-400 disabled:opacity-40"
                disabled={busy || !description.trim()}
                onClick={handleAiGenerate}
              >
                {busy ? "生成中..." : "AI 生成"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
