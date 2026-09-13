import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Circle,
  CircleDot,
  FileText,
  Hammer,
  LoaderCircle,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  derivePlanProgress,
  parsePlanMarkdown,
  type PlanArtifactPayload,
} from "../../utils/plan-artifact";
import {
  loadAbsoluteFilePreview,
  previewCopyText,
} from "../workspace/workspace-preview-types";

type Props = {
  initialPlan: PlanArtifactPayload;
  onViewPlan?: (path: string) => void;
  onBuildPlan?: (plan: PlanArtifactPayload) => void | Promise<void>;
};

export function PlanArtifactCard({
  initialPlan,
  onViewPlan,
  onBuildPlan,
}: Props) {
  const { t } = useTranslation("chat");
  const [plan, setPlan] = useState(initialPlan);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const progress = useMemo(() => derivePlanProgress(plan), [plan]);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: number | undefined;
    let readTimer: number | undefined;

    const schedule = (delayMs: number) => {
      pollTimer = window.setTimeout(refresh, delayMs);
    };

    const refresh = async () => {
      const timeout = new Promise<{ ok: false; error: string }>((resolve) => {
        readTimer = window.setTimeout(
          () => resolve({ ok: false, error: t("planCard.readTimeout") }),
          5000,
        );
      });
      const loaded = await Promise.race([
        loadAbsoluteFilePreview(initialPlan.path),
        timeout,
      ]);
      if (readTimer !== undefined) window.clearTimeout(readTimer);
      if (cancelled) return;
      if (!loaded.ok) {
        setError(loaded.error);
        schedule(3000);
        return;
      }
      const latest = parsePlanMarkdown(previewCopyText(loaded.preview), initialPlan.path);
      if (!latest) {
        setError(t("planCard.invalidFile"));
        schedule(3000);
        return;
      }
      setPlan(latest);
      setError("");
      if (latest.status === "building") setStarting(false);
      if (latest.status === "ready" || latest.status === "building") {
        schedule(latest.status === "building" ? 1000 : 3000);
      }
    };

    void refresh();
    return () => {
      cancelled = true;
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
      if (readTimer !== undefined) window.clearTimeout(readTimer);
    };
  }, [initialPlan.path, t]);

  useEffect(() => {
    if (!starting || plan.status !== "ready") return;
    const timer = window.setTimeout(() => {
      setStarting(false);
      setError(t("planCard.startTimeout"));
    }, 20_000);
    return () => window.clearTimeout(timer);
  }, [plan.status, starting, t]);

  const building = starting || plan.status === "building";
  const title =
    plan.status === "completed"
      ? t("planCard.completed")
      : building
        ? t("planCard.building")
        : plan.status === "cancelled"
          ? t("planCard.cancelled")
          : t("planCard.created");

  return (
    <div className="my-2 w-full min-w-0 px-4">
      <section className="overflow-hidden rounded-xl border border-border bg-surface-card shadow-sm">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-hover text-text-muted">
            <FileText className="h-4 w-4" strokeWidth={1.8} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-faint">
              {title}
            </div>
            <h3 className="truncate text-[14px] font-medium text-text-strong">{plan.name}</h3>
          </div>
          <span className="text-[11px] tabular-nums text-text-faint">
            {progress.completed}/{progress.total}
          </span>
        </header>

        <div className="space-y-3 px-4 py-3">
          <p className="line-clamp-4 text-[13px] leading-5 text-text-muted">{plan.overview}</p>
          <div className="h-1 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
            <div
              className="h-full rounded-full bg-text-muted transition-[width] duration-300"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <ul className="space-y-2">
            {plan.todos.map((todo) => {
              const Icon =
                todo.status === "completed"
                  ? Check
                  : todo.status === "in_progress"
                    ? LoaderCircle
                    : todo.status === "cancelled"
                      ? X
                      : Circle;
              return (
                <li
                  key={todo.id}
                  className={`flex min-w-0 items-start gap-2 text-[12px] leading-5 ${
                    todo.status === "completed" || todo.status === "cancelled"
                      ? "text-text-faint line-through"
                      : "text-text-standard"
                  }`}
                >
                  <Icon
                    className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                      todo.status === "in_progress" ? "animate-spin text-text-strong" : ""
                    }`}
                    strokeWidth={2}
                    aria-hidden
                  />
                  <span className="min-w-0 break-words">{todo.content}</span>
                </li>
              );
            })}
          </ul>
          {error ? (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-500">
              <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{t("planCard.loadFailed", { error })}</span>
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-[12px] text-text-muted transition-colors hover:bg-surface-hover hover:text-text-strong"
            onClick={() => onViewPlan?.(plan.path)}
          >
            {t("planCard.view")}
          </button>
          <button
            type="button"
            disabled={Boolean(error) || plan.status !== "ready" || starting || !onBuildPlan}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--ui-btn-primary-bg)] px-3 py-1.5 text-[12px] font-medium text-[var(--ui-btn-primary-text)] transition-opacity hover:bg-[var(--ui-btn-primary-hover)] disabled:cursor-not-allowed disabled:opacity-45"
            onClick={async () => {
              if (!onBuildPlan) return;
              setError("");
              setStarting(true);
              try {
                await onBuildPlan(plan);
              } catch (buildError) {
                setStarting(false);
                setError(
                  buildError instanceof Error
                    ? buildError.message
                    : t("planCard.startFailed"),
                );
              }
            }}
          >
            {building ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : plan.status === "completed" ? (
              <Check className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Hammer className="h-3.5 w-3.5" aria-hidden />
            )}
            {building
              ? t("planCard.building")
              : plan.status === "completed"
                ? t("planCard.completed")
                : t("planCard.build")}
          </button>
        </footer>
      </section>
    </div>
  );
}
