import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export type MergeRoomRef = {
  id: string;
  title: string;
  room_kind: string;
  parent_room_id: string | null;
};

export type MergeMode = "all" | "selected" | "summary";

type Props = {
  open: boolean;
  source: MergeRoomRef;
  rooms: MergeRoomRef[];
  selectedCount: number;
  initialMode?: MergeMode;
  submitting: boolean;
  error: string;
  onClose: () => void;
  onGenerate: () => Promise<string>;
  onConfirm: (input: { targetRoomId: string; mode: MergeMode; summaryText: string }) => void;
};

export function listMergeTargets(source: MergeRoomRef, rooms: MergeRoomRef[]): MergeRoomRef[] {
  const main = rooms.find((room) => room.room_kind === "main") ?? null;
  if (source.room_kind === "direct") return main ? [main] : [];
  const parent = source.parent_room_id
    ? (rooms.find((room) => room.id === source.parent_room_id) ?? null)
    : null;
  const targets: MergeRoomRef[] = [];
  if (parent) targets.push(parent);
  if (main && main.id !== parent?.id) targets.push(main);
  return targets;
}

function showsSummary(mode: MergeMode): boolean {
  switch (mode) {
    case "summary":
      return true;
    case "all":
    case "selected":
      return false;
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

export function MergeBackDialog({
  open,
  source,
  rooms,
  selectedCount,
  initialMode = "all",
  submitting,
  error,
  onClose,
  onGenerate,
  onConfirm,
}: Props) {
  const { t } = useTranslation("projects");
  const [mode, setMode] = useState<MergeMode>("all");
  const [targetId, setTargetId] = useState("");
  const [summary, setSummary] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [generating, setGenerating] = useState(false);
  const wasOpen = useRef(false);
  const targets = listMergeTargets(source, rooms);

  useEffect(() => {
    if (open && !wasOpen.current) {
      const nextMode = initialMode === "selected" && selectedCount === 0 ? "all" : initialMode;
      setMode(nextMode);
      setSummary("");
      setSummaryError("");
      setGenerating(false);
      setTargetId(listMergeTargets(source, rooms)[0]?.id ?? "");
    }
    wasOpen.current = open;
  }, [initialMode, open, rooms, selectedCount, source]);

  if (!open) return null;

  const summaryBlank = summary.trim().length === 0;
  const confirmDisabled =
    submitting ||
    !targetId ||
    (mode === "summary" && summaryBlank) ||
    (mode === "selected" && selectedCount === 0);

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    setSummaryError("");
    try {
      const text = await onGenerate();
      setSummary(text);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : t("loadFailed"));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="agx-merge-back-title"
        className="flex max-h-[min(640px,calc(100vh-32px))] w-full max-w-[480px] flex-col overflow-hidden rounded-xl border border-border bg-surface-base shadow-2xl"
      >
        <div className="border-b border-border px-4 py-3">
          <h3 id="agx-merge-back-title" className="text-sm font-semibold text-text-strong">
            {t("merge.action")}
          </h3>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <label className="block text-[13px] text-text-strong" htmlFor="agx-merge-target">
            {t("merge.target")}
          </label>
          <select
            id="agx-merge-target"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface-card px-2 py-1.5 text-[13px] text-text-primary outline-none"
          >
            {targets.map((room) => (
              <option key={room.id} value={room.id}>
                {room.title}
              </option>
            ))}
          </select>
          <div className="mt-4 text-[13px] text-text-strong">{t("merge.modeLabel")}</div>
          <div className="mt-1 space-y-1">
            <label className="flex items-center gap-2 text-[13px] text-text-primary">
              <input
                type="radio"
                name="agx-merge-mode"
                checked={mode === "all"}
                onChange={() => setMode("all")}
              />
              {t("merge.mode.all")}
            </label>
            <label className="flex items-center gap-2 text-[13px] text-text-primary">
              <input
                type="radio"
                name="agx-merge-mode"
                checked={mode === "selected"}
                disabled={selectedCount === 0}
                onChange={() => setMode("selected")}
              />
              {t("merge.mode.selected", { count: selectedCount })}
            </label>
            <label className="flex items-center gap-2 text-[13px] text-text-primary">
              <input
                type="radio"
                name="agx-merge-mode"
                checked={mode === "summary"}
                onChange={() => setMode("summary")}
              />
              {t("merge.mode.summary")}
            </label>
          </div>
          {showsSummary(mode) ? (
            <div className="mt-3">
              <textarea
                aria-label={t("merge.mode.summary")}
                value={summary}
                rows={5}
                onChange={(event) => setSummary(event.target.value)}
                className="w-full resize-y rounded-md border border-border bg-surface-card px-2 py-1.5 text-[13px] text-text-primary outline-none"
              />
              <button
                type="button"
                className="mt-2 rounded-md border border-border px-2 py-1 text-[12px] text-text-muted hover:bg-surface-hover disabled:opacity-50"
                disabled={generating}
                onClick={() => void generate()}
              >
                {generating ? t("merge.generating") : t("merge.generate")}
              </button>
              {summaryError ? <p className="mt-1 text-[12px] text-rose-400">{summaryError}</p> : null}
            </div>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="px-4 pb-2 text-[12px] text-rose-400">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm text-text-muted hover:bg-surface-hover"
            onClick={onClose}
          >
            {t("dialog.cancel")}
          </button>
          <button
            type="button"
            disabled={confirmDisabled}
            aria-busy={submitting}
            className="rounded-md bg-[var(--ui-btn-primary-bg)] px-3 py-1.5 text-sm font-medium text-[var(--ui-btn-primary-text)] hover:bg-[var(--ui-btn-primary-bg-hover,var(--ui-btn-primary-bg))] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => {
              if (confirmDisabled) return;
              onConfirm({ targetRoomId: targetId, mode, summaryText: summary.trim() });
            }}
          >
            {t("merge.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
