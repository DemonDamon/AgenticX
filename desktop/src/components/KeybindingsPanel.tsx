type Props = {
  open: boolean;
  mode: "pro" | "lite";
  onClose: () => void;
};

const PRO_ITEMS = [
  ["Ctrl/Cmd+K", "打开命令面板"],
  ["Ctrl+,", "打开设置"],
  ["Ctrl+L", "清空消息"],
  ["Ctrl+Shift+M", "切换 Pro/Lite"],
  ["Ctrl+Shift+P", "切换计划模式"],
  ["Alt+↑ / Alt+↓", "历史输入导航"],
  ["Enter", "发送"],
  ["Shift+Enter", "换行"],
  ["Escape", "关闭面板或中断生成"],
];

const LITE_ITEMS = [
  ["Ctrl+,", "打开设置"],
  ["Ctrl+Shift+M", "切换 Pro/Lite"],
  ["Enter", "发送"],
  ["Shift+Enter", "换行"],
  ["Escape", "中断生成"],
];

export function KeybindingsPanel({ open, mode, onClose }: Props) {
  if (!open) return null;
  const items = mode === "pro" ? PRO_ITEMS : LITE_ITEMS;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-xl rounded-xl border border-border bg-slate-900 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium text-slate-200">快捷键列表（{mode.toUpperCase()}）</div>
          <button className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="space-y-2">
          {items.map(([key, desc]) => (
            <div key={key} className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2">
              <code className="text-xs text-cyan-300">{key}</code>
              <span className="text-xs text-slate-300">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
