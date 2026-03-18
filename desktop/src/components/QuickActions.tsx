type Props = {
  onSend: (text: string) => void;
};

const QUICK_ACTIONS = [
  { label: "写文章", prompt: "请根据我接下来给的信息写一篇结构清晰的文章。" },
  { label: "翻译", prompt: "请将我接下来发的内容准确翻译成中文并保留关键术语。" },
  { label: "总结", prompt: "请总结最近对话重点，并给出 3 条可执行建议。" },
  { label: "管理文件", prompt: "请帮我规划本地文件整理方案，先询问我目录目标。" },
  { label: "搜索", prompt: "请先澄清我的问题，再给出可验证的信息检索结果。" },
  { label: "做计划", prompt: "请为我的目标生成分步骤计划，包含风险与里程碑。" },
];

export function QuickActions({ onSend }: Props) {
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {QUICK_ACTIONS.map((text) => (
        <button
          key={text.label}
          onClick={() => onSend(text.prompt)}
          className="rounded-full border border-border bg-surface-card px-3 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover"
        >
          {text.label}
        </button>
      ))}
    </div>
  );
}
