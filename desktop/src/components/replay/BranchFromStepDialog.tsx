import { AlertTriangle, GitBranch, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BranchEffectWarning } from "./branch-client";

export type BranchProgressStage =
  | "validate"
  | "restore"
  | "open_session"
  | "send_instruction";

type Props = {
  open: boolean;
  requestedSeq: number;
  resolvedSeq: number;
  skippedToolCount: number;
  workspaceStatus: string;
  warnings: BranchEffectWarning[];
  initialInstruction?: string;
  initialProvider?: string;
  initialModel?: string;
  submitting: boolean;
  stage?: BranchProgressStage;
  error: { code: string; detail: string } | null;
  onCancel: () => void;
  onSubmit: (value: {
    instruction: string;
    provider?: string;
    model?: string;
  }) => Promise<void>;
};

export function BranchFromStepDialog({
  open,
  requestedSeq,
  resolvedSeq,
  skippedToolCount,
  workspaceStatus,
  warnings,
  initialInstruction = "",
  initialProvider = "",
  initialModel = "",
  submitting,
  stage = "validate",
  error,
  onCancel,
  onSubmit,
}: Props) {
  const { t } = useTranslation("workspace");
  const [instruction, setInstruction] = useState(initialInstruction);
  const [provider, setProvider] = useState(initialProvider);
  const [model, setModel] = useState(initialModel);

  useEffect(() => {
    if (!open) return;
    setInstruction(initialInstruction);
    setProvider(initialProvider);
    setModel(initialModel);
  }, [initialInstruction, initialModel, initialProvider, open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="branch-step-title"
        className="flex max-h-[88vh] w-full max-w-[640px] flex-col overflow-hidden rounded-xl border border-border bg-surface-panel shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <GitBranch aria-hidden className="h-4 w-4 text-text-muted" />
            <h2 id="branch-step-title" className="text-[14px] font-medium text-text-strong">
              {t("replay.branchFromBefore")}
            </h2>
          </div>
          <button
            type="button"
            aria-label={t("replay.branchClose")}
            className="rounded-md p-1 text-text-faint hover:bg-surface-hover hover:text-text-strong"
            disabled={submitting}
            onClick={onCancel}
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-surface-card px-3 py-2">
              <div className="text-[10px] text-text-faint">{t("replay.branchRequestedStep")}</div>
              <div className="mt-1 font-mono text-[13px] text-text-strong">#{requestedSeq}</div>
            </div>
            <div className="rounded-lg bg-surface-card px-3 py-2">
              <div className="text-[10px] text-text-faint">{t("replay.branchRestoredStep")}</div>
              <div className="mt-1 font-mono text-[13px] text-text-strong">#{resolvedSeq}</div>
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-text-muted">
            {t("replay.branchSkippedTools", { count: skippedToolCount })}
            {" "}
            {t("replay.branchExternalWarning")}
          </p>
          <div className="rounded-lg bg-surface-card px-3 py-2 text-[11px] text-text-muted">
            {t("replay.branchWorkspaceStatus")}:{" "}
            {t(`replay.branchReason.${workspaceStatus}`, { defaultValue: workspaceStatus })}
          </div>
          {warnings.length > 0 ? (
            <div className="rounded-lg bg-status-warning/10 px-3 py-2 text-[11px] text-status-warning">
              <div className="flex items-center gap-1.5 font-medium">
                <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
                {t("replay.branchEffectsWarning")}
              </div>
              <ul className="mt-1 space-y-0.5">
                {warnings.map((warning) => (
                  <li key={`${warning.effectClass}:${warning.toolName}`}>
                    {warning.toolName} × {warning.count}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <label className="block">
            <span className="text-[11px] text-text-muted">{t("replay.branchInstruction")}</span>
            <textarea
              className="mt-1 min-h-28 w-full resize-y rounded-lg border border-border bg-surface-card px-3 py-2 text-[12px] text-text-strong outline-none focus:border-border-strong"
              value={instruction}
              maxLength={20_000}
              disabled={submitting}
              onChange={(event) => setInstruction(event.target.value)}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] text-text-muted">{t("replay.branchProvider")}</span>
              <input
                className="mt-1 w-full rounded-lg border border-border bg-surface-card px-3 py-2 text-[12px] text-text-strong outline-none focus:border-border-strong"
                value={provider}
                disabled={submitting}
                onChange={(event) => setProvider(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-text-muted">{t("replay.branchModel")}</span>
              <input
                className="mt-1 w-full rounded-lg border border-border bg-surface-card px-3 py-2 text-[12px] text-text-strong outline-none focus:border-border-strong"
                value={model}
                disabled={submitting}
                onChange={(event) => setModel(event.target.value)}
              />
            </label>
          </div>
          {submitting ? (
            <div className="flex items-center gap-2 text-[11px] text-text-muted">
              <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" />
              {t(`replay.branchStage.${stage}`)}
            </div>
          ) : null}
          {error ? (
            <div className="rounded-lg bg-status-error/10 px-3 py-2 text-[11px] text-status-error">
              <div className="font-mono">{error.code}</div>
              <div className="mt-1 break-words">{error.detail}</div>
            </div>
          ) : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            className="rounded-lg bg-surface-hover px-4 py-2 text-[12px] text-text-muted hover:bg-surface-card-strong"
            disabled={submitting}
            onClick={onCancel}
          >
            {t("replay.branchCancel")}
          </button>
          <button
            type="button"
            className="rounded-lg bg-[var(--ui-btn-primary-bg)] px-4 py-2 text-[12px] text-[var(--ui-btn-primary-text)] hover:bg-[var(--ui-btn-primary-hover)] disabled:opacity-50"
            disabled={submitting || !instruction.trim()}
            onClick={() => void onSubmit({
              instruction,
              ...(provider.trim() ? { provider: provider.trim() } : {}),
              ...(model.trim() ? { model: model.trim() } : {}),
            })}
          >
            {t("replay.branchContinue")}
          </button>
        </footer>
      </section>
    </div>
  );
}
