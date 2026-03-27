import { useState } from "react";
import { AvatarToolPermissionDialog } from "./AvatarToolPermissionDialog";

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
export function AvatarCreateDialog({ open, onClose, onCreate }: Props) {
  const [mode, setMode] = useState<Mode>("manual");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [toolsDialogOpen, setToolsDialogOpen] = useState(false);
  const [toolsEnabled, setToolsEnabled] = useState<Record<string, boolean>>({});
  const customizedCount = Object.keys(toolsEnabled).filter((key) => toolsEnabled[key] !== undefined).length;

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
      setToolsDialogOpen(false);
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
    setToolsDialogOpen(false);
    onClose();
  };

  return (
    <>
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

              <button
                type="button"
                className="w-full rounded-md border border-border bg-surface-card px-3 py-2 text-left text-sm text-text-muted transition hover:bg-surface-hover"
                onClick={() => setToolsDialogOpen(true)}
              >
                工具权限（{customizedCount > 0 ? `已自定义 ${customizedCount} 项` : "继承全局默认"}）
              </button>
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
      <AvatarToolPermissionDialog
        open={toolsDialogOpen}
        mode="avatar"
        title="新分身 · 工具权限"
        initialToolsEnabled={toolsEnabled}
        onClose={() => setToolsDialogOpen(false)}
        onSave={async (next) => {
          setToolsEnabled(next);
        }}
      />
    </>
  );
}
