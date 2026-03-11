import { useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreate: (data: { name: string; role: string; systemPrompt: string }) => Promise<void>;
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

  if (!open) return null;

  const handleCreate = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onCreate({ name: name.trim(), role: role.trim(), systemPrompt: systemPrompt.trim() });
      setName("");
      setRole("");
      setSystemPrompt("");
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
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-[440px] max-w-[95vw] rounded-xl border border-border bg-panel p-5">
        <h3 className="mb-4 text-base font-semibold text-slate-200">创建数字分身</h3>

        <div className="mb-4 flex gap-1 rounded-lg bg-slate-800/60 p-0.5">
          {([["manual", "手动创建"], ["ai", "AI 生成"]] as const).map(([key, label]) => (
            <button
              key={key}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                mode === key
                  ? "bg-cyan-500/20 text-cyan-400"
                  : "text-slate-400 hover:text-slate-200"
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
              <label className="block text-sm text-slate-300">
                名称 <span className="text-rose-400">*</span>
                <input
                  className="mt-1 w-full rounded-md border border-border bg-slate-900 px-3 py-2 text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例：Coder、Researcher、Writer"
                  autoFocus
                />
              </label>
              <label className="block text-sm text-slate-300">
                角色
                <input
                  className="mt-1 w-full rounded-md border border-border bg-slate-900 px-3 py-2 text-sm"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="例：全栈开发工程师、数据分析师"
                />
              </label>
              <label className="block text-sm text-slate-300">
                System Prompt
                <span className="ml-1 text-xs text-slate-500">(可选)</span>
                <textarea
                  className="mt-1 w-full resize-none rounded-md border border-border bg-slate-900 px-3 py-2 text-sm"
                  rows={3}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="自定义角色行为指令..."
                />
              </label>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                className="rounded-md border border-border px-4 py-1.5 text-sm text-slate-400 transition hover:bg-slate-700"
                onClick={resetAndClose}
              >
                取消
              </button>
              <button
                className="rounded-md bg-cyan-400 px-4 py-1.5 text-sm font-medium text-black transition hover:bg-cyan-300 disabled:opacity-40"
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
              <label className="block text-sm text-slate-300">
                描述你想要的分身
                <textarea
                  className="mt-1 w-full resize-none rounded-md border border-border bg-slate-900 px-3 py-2 text-sm"
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
                className="rounded-md border border-border px-4 py-1.5 text-sm text-slate-400 transition hover:bg-slate-700"
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
