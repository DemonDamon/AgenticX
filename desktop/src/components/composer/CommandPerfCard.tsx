import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PerfSummary } from "../../services/commandsApi";

type Props = {
  summary: PerfSummary | null;
  error: string;
  onClose: () => void;
};

function formatMs(value: number | null, missing: string): string {
  if (value == null) return missing;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${value}ms`;
}

export function CommandPerfCard({ summary, error, onClose }: Props) {
  const { t } = useTranslation("chat");
  const missing = t("composer.commands.missing");
  const latest = summary?.latest;
  return (
    <div className="mb-2 rounded-xl border border-border bg-surface-panel px-3 py-2 text-[12px] text-text-primary">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{t("composer.commands.perfTitle")}</div>
        <button type="button" className="rounded p-1 text-text-faint hover:bg-surface-hover" onClick={onClose} aria-label={t("composer.commands.close")}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {error ? <p className="mt-1 text-status-error">{error}</p> : null}
      {latest ? (
        <div className="mt-2 space-y-1 text-text-muted">
          <div>{t("composer.commands.model")} {latest.model || missing}</div>
          <div>{t("composer.commands.wall")} {formatMs(latest.wall_ms, missing)}</div>
          <div>{t("composer.commands.ttft")} {formatMs(latest.ttft_ms, missing)}</div>
          <div>
            {t("composer.commands.waits")}{" "}
            {latest.model_waits.length === 0
              ? missing
              : latest.model_waits.map((row) => `${row.until} ${formatMs(row.wait_ms, missing)}`).join(" · ")}
          </div>
          <div>{t("composer.commands.tools")} {formatMs(latest.tool_elapsed_ms, missing)}</div>
          <div>
            {t("composer.commands.slowest")}{" "}
            {latest.slowest_tool ? `${latest.slowest_tool.name} ${formatMs(latest.slowest_tool.elapsed_ms, missing)}` : missing}
          </div>
        </div>
      ) : !error ? (
        <p className="mt-1 text-text-faint">{t("composer.commands.noRuns")}</p>
      ) : null}
      {summary && summary.runs.length > 0 ? (
        <ul className="mt-2 space-y-0.5 border-t border-border pt-2 text-[11px] text-text-faint">
          {summary.runs.map((run) => (
            <li key={run.run_id}>
              {run.status} · {formatMs(run.wall_ms, missing)} · {t("composer.commands.ttft")} {formatMs(run.ttft_ms, missing)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
