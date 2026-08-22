import { useRef, useState } from "react";
import { Bot, Loader2, Users } from "lucide-react";
import { Modal } from "../ds/Modal";
import {
  createGroupFromTemplate,
  GroupTemplateCreationCancelledError,
  type GroupTemplateCreationProgress,
  type GroupTemplateCreationResult,
} from "./group-template-creation";
import type { GroupTemplate } from "./group-templates";

type Props = {
  template: GroupTemplate;
  initialGroupName: string;
  onClose: () => void;
  onCreated: (result: GroupTemplateCreationResult) => Promise<void> | void;
};

export function GroupTemplateCreateDialog({
  template,
  initialGroupName,
  onClose,
  onCreated,
}: Props) {
  const [groupName, setGroupName] = useState(initialGroupName);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<GroupTemplateCreationProgress | null>(null);
  const [error, setError] = useState("");
  const cancelRequestedRef = useRef(false);

  const handleCancel = () => {
    if (!busy) {
      onClose();
      return;
    }
    cancelRequestedRef.current = true;
    setProgress((current) => ({
      phase: "rolling-back",
      completed: current?.completed ?? 0,
      total: current?.total ?? template.members.length + 1,
      percent: current?.percent ?? 0,
      message: "正在停止创建并清理本次新增分身…",
    }));
  };

  const handleCreate = async () => {
    const normalizedName = groupName.trim();
    if (!normalizedName || busy) return;
    cancelRequestedRef.current = false;
    setBusy(true);
    setError("");
    setProgress(null);
    try {
      const result = await createGroupFromTemplate({
        template,
        groupName: normalizedName,
        api: window.agenticxDesktop,
        onProgress: setProgress,
        shouldCancel: () => cancelRequestedRef.current,
      });
      await onCreated(result);
      onClose();
    } catch (caught) {
      if (caught instanceof GroupTemplateCreationCancelledError) {
        onClose();
        return;
      }
      setProgress(null);
      setError(caught instanceof Error ? caught.message : "团队创建失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={`使用模板：${template.name}`}
      onClose={handleCancel}
      panelClassName="w-[min(660px,95vw)] max-h-[calc(100vh-2rem)] overflow-hidden bg-surface-panel"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-2 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
            onClick={handleCancel}
          >
            {busy ? "取消创建" : "取消"}
          </button>
          <button
            type="button"
            className="inline-flex min-w-[112px] items-center justify-center gap-1.5 rounded-md bg-btnPrimary px-4 py-2 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:cursor-not-allowed disabled:opacity-45"
            disabled={busy || !groupName.trim()}
            onClick={() => void handleCreate()}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Users className="h-3.5 w-3.5" aria-hidden />}
            {busy ? "创建中…" : `创建 ${template.members.length} 人团队`}
          </button>
        </div>
      }
    >
      <div className="max-h-[calc(100vh-12rem)] space-y-4 overflow-y-auto pr-1">
        <div>
          <p className="text-sm leading-relaxed text-text-muted">{template.description}</p>
          <div className="mt-3 rounded-lg border border-[rgba(var(--theme-color-rgb,59,130,246),0.28)] bg-[rgba(var(--theme-color-rgb,59,130,246),0.08)] px-3 py-2 text-xs leading-relaxed text-text-muted">
            将创建 {template.members.length} 个全新分身并组成智能协作群聊，不会使用或修改你已有的分身。
          </div>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-text-strong">团队名称</span>
          <input
            value={groupName}
            disabled={busy}
            autoFocus
            className="w-full rounded-lg border border-border bg-surface-card px-3 py-2.5 text-sm text-text-strong outline-none transition focus:border-border-strong disabled:opacity-60"
            placeholder="输入团队名称"
            onChange={(event) => setGroupName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !busy) void handleCreate();
            }}
          />
        </label>

        <div>
          <div className="mb-2 text-xs font-medium text-text-strong">模板成员</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {template.members.map((member) => (
              <div key={member.id} className="rounded-lg border border-border bg-surface-card p-3">
                <div className="flex items-start gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-panel text-text-muted">
                    <Bot className="h-4 w-4" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-text-strong">{member.name}</div>
                    <div className="mt-0.5 truncate text-[11px] text-text-subtle">{member.role}</div>
                  </div>
                </div>
                <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-text-muted">
                  {member.description}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {member.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="rounded bg-surface-panel px-1.5 py-0.5 text-[10px] text-text-faint">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {progress ? (
          <div className="rounded-lg border border-border bg-surface-card px-3 py-2.5" role="status">
            <div className="flex items-center justify-between gap-3 text-xs text-text-muted">
              <span className="min-w-0 truncate">{progress.message}</span>
              <span className="shrink-0 tabular-nums">{progress.percent}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-panel">
              <div
                className="h-full rounded-full bg-btnPrimary transition-[width] duration-200"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs leading-relaxed text-rose-300" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
