type Props = {
  onSelectMode: (mode: "pro" | "lite") => void;
};

export function OnboardingView({ onSelectMode }: Props) {
  return (
    <div className="flex h-screen items-center justify-center bg-base px-4">
      <div className="w-full max-w-3xl rounded-2xl border border-border bg-panel p-8">
        <h1 className="text-2xl font-semibold text-slate-100">欢迎使用 AgenticX Desktop</h1>
        <p className="mt-2 text-sm text-slate-400">
          请选择你的使用方式。后续可以在设置或快捷键中随时切换模式。
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <button
            className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-5 text-left transition hover:bg-cyan-500/20"
            onClick={() => onSelectMode("pro")}
          >
            <div className="text-lg font-medium text-cyan-300">我是开发者 (Pro)</div>
            <p className="mt-2 text-sm text-slate-300">
              启用命令面板、快捷键和更完整的技术操作体验。
            </p>
          </button>
          <button
            className="rounded-xl border border-slate-600 bg-slate-800/50 p-5 text-left transition hover:bg-slate-800"
            onClick={() => onSelectMode("lite")}
          >
            <div className="text-lg font-medium text-slate-200">我想简单使用 (Lite)</div>
            <p className="mt-2 text-sm text-slate-400">
              简洁界面，隐藏技术细节，适合日常问答与任务助手场景。
            </p>
          </button>
        </div>
      </div>
    </div>
  );
}
