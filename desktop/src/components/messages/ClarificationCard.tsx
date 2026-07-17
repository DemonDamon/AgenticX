import { useMemo, useState } from "react";
import { AlertCircle, Check, ChevronUp, Clock, Send } from "lucide-react";
import type { ClarificationDecision, PendingClarification } from "../../store";
import { buildClarificationAnswerText, inferClarificationDecisions, toggleDecisionSelection, type ClarificationAnswer } from "../../utils/clarification-notice";
import { ASSISTANT_INLINE_CARD_SHELL_CLASS, GROUP_INLINE_CARD_SHELL_CLASS } from "./im-layout";

/** Minimal line-art glyph for clarification prompts (Near-style, stroke-only). */
function ClarificationGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="8" cy="8" r="6.1" />
      <path d="M6.15 6.05a1.9 1.9 0 0 1 3.55.98c0 1.05-.92 1.38-1.42 1.68-.28.17-.48.42-.48.74" />
      <circle cx="8" cy="11.35" r="0.55" fill="currentColor" stroke="none" />
    </svg>
  );
}

type Props = {
  prompt: PendingClarification;
  suspended?: boolean;
  /** If provided, the card shows the answered state with this content */
  initialAnswer?: ClarificationAnswer | null;
  /** Fallback: open a larger reply surface (e.g. legacy Dialog) */
  onReply?: (prompt: PendingClarification) => void;
  /**
   * Preferred: fully inline submit. Parent performs POST /api/clarify and
   * returns true on a clear success. Returns false on a clear business
   * failure (e.g. 404). Throws on network error (treated as "maybe sent").
   */
  onSubmitAnswer?: (requestId: string, answer: ClarificationAnswer) => Promise<boolean> | boolean;
  /** Skip = submit an empty answer to the backend (so the gate resolves) */
  onSkip?: (requestId: string) => void;
  /** Group chat: offset past member avatar so the card aligns with bubble content. */
  groupChatRail?: boolean;
};

export function ClarificationCard({
  prompt,
  suspended,
  initialAnswer,
  onReply,
  onSubmitAnswer,
  onSkip,
  groupChatRail = false,
}: Props) {
  const shellClass = groupChatRail ? GROUP_INLINE_CARD_SHELL_CLASS : ASSISTANT_INLINE_CARD_SHELL_CLASS;
  const opts = useMemo(
    () => (prompt.options ?? []).filter((o) => typeof o === "string" && o.trim().length > 0),
    [prompt.options],
  );
  const decisions = useMemo(() => {
    const explicit = (prompt.decisions ?? []).filter((d) => d.question.trim() && (d.options?.length ?? 0) > 0);
    const source = explicit.length > 0 ? explicit : inferClarificationDecisions(prompt.context, opts);
    return source.map((d) => ({
      ...d,
      selectionMode: d.selectionMode === "multiple" ? ("multiple" as const) : ("single" as const),
      exclusiveOptions: Array.isArray(d.exclusiveOptions) ? d.exclusiveOptions : [],
    }));
  }, [prompt.decisions, prompt.context, opts]);
  const groupedMode = decisions.length > 0;
  const hasMultipleDecision = decisions.some((d) => d.selectionMode === "multiple");
  const canFree = prompt.allowFreeText !== false;

  const [selectedFlat, setSelectedFlat] = useState<Set<string>>(() => new Set());
  const [selectedByDecision, setSelectedByDecision] = useState<Record<string, string[]>>({});
  const [customByDecision, setCustomByDecision] = useState<Record<string, string>>({});
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maybeSent, setMaybeSent] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [answered, setAnswered] = useState<ClarificationAnswer | null>(initialAnswer ?? null);

  const contextSnapshot = useMemo(() => {
    const ctx = prompt.context;
    if (!ctx || typeof ctx !== "object") return [] as Array<[string, string]>;
    return Object.entries(ctx)
      .filter(([k, v]) => k !== "request_id" && v !== null && v !== undefined && String(v).trim())
      .map(([k, v]) => [k, String(v)] as [string, string]);
  }, [prompt.context]);

  const decisionAnswered = (decision: ClarificationDecision) => {
    const choices = selectedByDecision[decision.id] ?? [];
    const custom = customByDecision[decision.id]?.trim();
    return Boolean(choices.length > 0 || (canFree && custom));
  };

  const canSubmit = useMemo(() => {
    if (answered) return false;
    if (groupedMode) {
      return decisions.every((d) => decisionAnswered(d));
    }
    const hasCustom = canFree && customOpen && customText.trim().length > 0;
    return selectedFlat.size > 0 || hasCustom;
  }, [
    answered,
    canFree,
    customOpen,
    customText,
    customByDecision,
    decisions,
    groupedMode,
    selectedByDecision,
    selectedFlat.size,
  ]);

  const toggleFlatOption = (opt: string) => {
    if (answered || submitting) return;
    setError(null);
    setSelectedFlat((prev) => {
      const next = new Set(prev);
      if (next.has(opt)) next.delete(opt);
      else next.add(opt);
      return next;
    });
    if (customOpen) setCustomOpen(false);
  };

  const selectDecisionOption = (decision: ClarificationDecision, opt: string) => {
    if (answered || submitting) return;
    setError(null);
    setSelectedByDecision((prev) => {
      const next = toggleDecisionSelection(decision, prev[decision.id] ?? [], opt);
      if (next.length === 0) {
        const { [decision.id]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [decision.id]: next };
    });
  };

  const setDecisionCustom = (decisionId: string, value: string) => {
    if (answered || submitting) return;
    setError(null);
    setCustomByDecision((prev) => ({ ...prev, [decisionId]: value }));
  };

  const buildAnswer = (): ClarificationAnswer => {
    if (groupedMode) {
      const selectedOptions = decisions
        .map((d) => {
          const choices = (selectedByDecision[d.id] ?? []).map((c) => c.trim()).filter(Boolean);
          const choiceText = choices.join("、");
          const custom = canFree ? customByDecision[d.id]?.trim() : "";
          if (choiceText && custom) return `${d.question}：${choiceText}（补充：${custom}）`;
          if (choiceText) return `${d.question}：${choiceText}`;
          if (custom) return `${d.question}：${custom}`;
          return null;
        })
        .filter((v): v is string => Boolean(v));
      return { answerText: "", selectedOptions };
    }
    return {
      answerText: customOpen ? customText.trim() : "",
      selectedOptions: Array.from(selectedFlat),
    };
  };

  const handleSubmit = async () => {
    if (!canSubmit || submitting || answered) return;

    setSubmitting(true);
    setError(null);
    setMaybeSent(false);

    const answer = buildAnswer();

    // No backend hook AND no fallback: nothing we can do. Bail honestly.
    if (!onSubmitAnswer && !onReply) {
      setSubmitting(false);
      setError("无法提交（未连接后端），请重试或刷新。");
      return;
    }

    // Fallback path: defer to parent's Dialog.
    if (!onSubmitAnswer && onReply) {
      onReply(prompt);
      setSubmitting(false);
      return;
    }

    try {
      const ok = await onSubmitAnswer!(prompt.requestId, answer);
      if (ok) {
        setAnswered(answer);
      } else {
        // Clear business failure (e.g. 404 already-resolved). Don't pretend success.
        setError("该提问已被处理或已失效，无需再次提交。");
      }
    } catch (e: unknown) {
      // Network error: the request may have reached the backend. Don't let the
      // user blindly retry (that would 404 if the gate already resolved).
      setMaybeSent(true);
      const msg = e instanceof Error ? e.message : "网络错误";
      setError(
        `${msg}。请求可能已送达后端，请勿立即重试——稍候观察智能体是否继续，或刷新会话查看状态。`,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    if (answered || submitting) return;
    setError(null);
    const empty: ClarificationAnswer = { answerText: "", selectedOptions: [] };
    // Skip MUST resolve the backend gate, otherwise the turn hangs until timeout.
    if (onSkip) {
      onSkip(prompt.requestId);
    } else if (onSubmitAnswer) {
      // Best-effort: submit empty answer through the same channel.
      setSubmitting(true);
      Promise.resolve(onSubmitAnswer(prompt.requestId, empty))
        .then((ok) => {
          if (ok) setAnswered(empty);
          else setError("跳过请求未被接受，请稍后重试。");
        })
        .catch(() => {
          setMaybeSent(true);
          setError("跳过请求网络错误，可能已送达。请稍候观察智能体是否继续。");
        })
        .finally(() => setSubmitting(false));
      return;
    }
    setAnswered(empty);
  };

  const handleRetry = () => {
    setError(null);
    setMaybeSent(false);
    void handleSubmit();
  };

  // ── Minimized (pending only) ──────────────────────────────────────────────
  if (minimized && !answered) {
    return (
      <div
        className={`${shellClass} inline-flex w-fit max-w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface-card px-3 py-1.5 text-xs text-text-muted hover:bg-surface-hover hover:text-text-strong`}
        onClick={() => setMinimized(false)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setMinimized(false);
          }
        }}
      >
        <Clock className="h-3.5 w-3.5" />
        <span>有待确认的决策（点击展开）</span>
        <span className="ml-1 truncate text-[10px] text-text-faint">
          · {prompt.prompt.slice(0, 32)}…
        </span>
      </div>
    );
  }

  // ── Answered ──────────────────────────────────────────────────────────────
  if (answered) {
    const answerText = buildClarificationAnswerText(answered);
    return (
      <div className={`${shellClass} overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-surface-card text-sm`}>
        <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-text-muted">
          <Check className="h-3.5 w-3.5 text-[var(--ui-btn-primary-bg)]" />
          <span>已回复</span>
          {suspended && <span className="ml-auto text-amber-300/70">（无人值守会话）</span>}
        </div>
        <div className="px-3 pb-2 text-[13px] text-text-strong">{answerText}</div>
        <div className="px-3 pb-2.5 text-[11px] text-text-faint">
          智能体已收到你的选择，将在同一回合内继续执行。
        </div>
      </div>
    );
  }

  // ── Suspended (unattended/automation) ──────────────────────────────────────
  if (suspended) {
    return (
      <div className={`${shellClass} rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200`}>
        无人值守会话已向你发起提问，当前已挂起。回来后可点击「回复」继续。
        {onReply && (
          <button
            type="button"
            className="ml-2 underline decoration-dotted hover:text-amber-100"
            onClick={() => onReply(prompt)}
          >
            回复
          </button>
        )}
      </div>
    );
  }

  // ── Active question ───────────────────────────────────────────────────────
  return (
    <div
      className={`${shellClass} overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-surface-card text-sm`}
      role="dialog"
      aria-label="需要你的输入"
    >
      {/* Header — no hard divider; rely on spacing + subtle tint */}
      <div className="flex items-center justify-between bg-surface-card-strong/20 px-3 py-2">
        <div className="flex items-center gap-2 text-[12px] font-medium text-text-strong">
          <span className="flex h-5 w-5 items-center justify-center text-[var(--ui-btn-primary-bg)]">
            <ClarificationGlyph className="h-4 w-4" />
          </span>
          需要你的输入
        </div>
        <div className="flex items-center gap-1">
          {onReply && (
            <button
              type="button"
              onClick={() => onReply(prompt)}
              className="rounded px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text-strong"
            >
              对话框回复
            </button>
          )}
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text-strong"
            title="稍后处理"
            aria-label="收起"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Prompt */}
      <div className="px-3 pt-2.5">
        <div className="border-l-[3px] border-[var(--ui-btn-primary-bg)] pl-2.5 text-[13px] leading-snug text-text-strong/90">
          {prompt.prompt}
        </div>

        {contextSnapshot.length > 0 && (
          <div className="mt-2 rounded-md bg-surface-panel/40 px-2.5 py-2 text-[11px] text-text-muted">
            <div className="mb-1 text-[10px] uppercase tracking-[0.4px] text-text-faint">当前方案快照</div>
            <div className="space-y-0.5">
              {contextSnapshot.map(([key, value]) => (
                <div key={key}>
                  <span className="text-text-faint">{key}：</span>
                  {value}
                </div>
              ))}
            </div>
          </div>
        )}

        {groupedMode ? (
          <div className="mt-3 space-y-3">
            {decisions.map((decision, idx) => {
              const isMultiple = decision.selectionMode === "multiple";
              const selected = selectedByDecision[decision.id] ?? [];
              return (
              <div key={decision.id}>
                <div className="flex items-baseline gap-1.5 text-[11px] font-medium text-text-muted">
                  <span className="shrink-0 rounded bg-surface-panel px-1.5 py-0.5 text-[10px] text-text-faint">
                    决策 {idx + 1}
                  </span>
                  <span className="text-text-strong/90">{decision.question}</span>
                  {isMultiple && (
                    <span className="shrink-0 text-[10px] font-normal text-text-faint">可多选</span>
                  )}
                </div>
                <div
                  className="mt-1.5 flex flex-wrap gap-1.5"
                  role={isMultiple ? "group" : "radiogroup"}
                  aria-label={decision.question}
                >
                  {decision.options.map((opt) => {
                    const isOn = selected.includes(opt);
                    return (
                      <button
                        key={`${decision.id}:${opt}`}
                        type="button"
                        role={isMultiple ? "checkbox" : "radio"}
                        aria-checked={isOn}
                        onClick={() => selectDecisionOption(decision, opt)}
                        disabled={submitting}
                        className={
                          "inline-flex items-center rounded-full border px-3 py-1 text-xs transition-all active:scale-[0.985] disabled:opacity-50 " +
                          (isOn
                            ? "border-transparent text-[var(--ui-btn-primary-text)]"
                            : "border-[var(--border-muted)] text-text-primary hover:border-[var(--ui-btn-primary-bg)]/50 hover:bg-surface-hover")
                        }
                        style={isOn ? { background: "var(--ui-btn-primary-bg)" } : undefined}
                      >
                        {opt}
                        {isOn && <Check className="ml-1 h-3 w-3 opacity-90" />}
                      </button>
                    );
                  })}
                </div>
                {canFree && (
                  <div className="mt-2">
                    <label
                      className="mb-1 block text-[10px] text-text-faint"
                      htmlFor={`clarify-custom-${decision.id}`}
                    >
                      自定义回复
                    </label>
                    <textarea
                      id={`clarify-custom-${decision.id}`}
                      value={customByDecision[decision.id] ?? ""}
                      onChange={(e) => setDecisionCustom(decision.id, e.target.value)}
                      placeholder="选项都不合适时，在此说明你的具体想法…"
                      rows={2}
                      disabled={submitting}
                      className="w-full resize-y rounded-lg border border-[var(--border-muted)] bg-surface-card px-2.5 py-1.5 text-xs leading-snug text-text-primary outline-none transition-colors placeholder:text-xs placeholder:text-text-faint hover:border-[var(--border-subtle)] focus:border-[var(--ui-btn-primary-bg)]/40 disabled:opacity-50"
                    />
                  </div>
                )}
              </div>
              );
            })}
          </div>
        ) : (
          opts.length > 0 && (
            <>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="text-[10px] uppercase tracking-[0.5px] text-text-faint">推荐选项</div>
                <div className="text-[10px] text-text-faint">可多选</div>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="推荐选项">
                {opts.map((opt) => {
                  const isOn = selectedFlat.has(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      role="checkbox"
                      aria-checked={isOn}
                      onClick={() => toggleFlatOption(opt)}
                      disabled={submitting}
                      className={
                        "inline-flex items-center rounded-full border px-3 py-1 text-xs transition-all active:scale-[0.985] disabled:opacity-50 " +
                        (isOn
                          ? "border-transparent text-[var(--ui-btn-primary-text)]"
                          : "border-[var(--border-muted)] text-text-primary hover:border-[var(--ui-btn-primary-bg)]/50 hover:bg-surface-hover")
                      }
                      style={isOn ? { background: "var(--ui-btn-primary-bg)" } : undefined}
                    >
                      {opt}
                      {isOn && <Check className="ml-1 h-3 w-3 opacity-90" />}
                    </button>
                  );
                })}
              </div>
            </>
          )
        )}

        {/* Flat mode: one global custom reply */}
        {canFree && !groupedMode && (
          <div className="mt-2">
            <label className="flex cursor-pointer items-center gap-2 text-[10px] text-text-faint select-none">
              <input
                type="checkbox"
                checked={customOpen}
                onChange={(e) => {
                  const v = e.target.checked;
                  setCustomOpen(v);
                  if (!v) setCustomText("");
                  if (v) setSelectedFlat(new Set());
                  setError(null);
                }}
                className="h-3.5 w-3.5 accent-[var(--ui-btn-primary-bg)]"
              />
              自定义回复
            </label>
            {customOpen && (
              <textarea
                value={customText}
                onChange={(e) => {
                  setCustomText(e.target.value);
                  setError(null);
                }}
                placeholder="补充你的具体想法…"
                rows={3}
                className="mt-1.5 w-full resize-y rounded-lg border border-[var(--border-muted)] bg-surface-card px-2.5 py-1.5 text-xs leading-snug text-text-primary outline-none transition-colors placeholder:text-xs placeholder:text-text-faint hover:border-[var(--border-subtle)] focus:border-[var(--ui-btn-primary-bg)]/40"
              />
            )}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-2 flex items-start gap-2 rounded border border-red-500/30 bg-red-500/5 px-2 py-1 text-xs text-red-300"
          >
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
            <div className="flex-1">{error}</div>
            {!maybeSent && (
              <button
                type="button"
                onClick={handleRetry}
                className="underline decoration-dotted hover:text-red-200"
              >
                重试
              </button>
            )}
          </div>
        )}
      </div>

      {/* Actions — soft footer, no top rule */}
      <div className="flex items-center justify-between px-3 pb-2.5 pt-1 text-xs">
        <div className="text-[11px] text-text-faint">
          {groupedMode
            ? hasMultipleDecision
              ? "完成每项决策后提交 · 标记为可多选的决策可组合选择"
              : "完成每项决策后提交"
            : "可多选 · 提交后同一回合继续 · 不会打断其他窗格"}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSkip}
            disabled={submitting}
            className="rounded px-2 py-1 text-text-muted hover:bg-surface-hover hover:text-text-strong disabled:opacity-50"
          >
            跳过（按默认推进）
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className={
              "flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium shadow-sm transition active:opacity-90 disabled:cursor-not-allowed " +
              (canSubmit
                ? "text-[var(--ui-btn-primary-text)]"
                : "bg-surface-hover text-text-muted")
            }
            style={canSubmit ? { background: "var(--ui-btn-primary-bg)" } : undefined}
          >
            {submitting ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
                提交中
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5" />
                提交决策
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
