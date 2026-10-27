"use client";

import React, { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";

import {
  formatClockTime,
  formatDuration,
  MA_STOP_REASONS,
  TOOL_TEXT_PREVIEW_CHARS,
  type DurationUnits,
  type ReplayItem,
} from "../../lib/ma-session-console";

export function SessionReplayTimeline({ items }: { items: ReplayItem[] }) {
  const t = useTranslations("pages.ops.managedSessions");
  const locale = useLocale();
  const units: DurationUnits = { ms: t("units.ms"), s: t("units.s"), m: t("units.m") };
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());

  return (
    <ol className="flex flex-col gap-3">
      {items.map((item, index) => (
        <li key={`${item.kind}-${item.seq}-${index}`} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
          <div className="pt-1 font-mono text-xs text-muted-foreground">
            <div>#{item.seq}</div>
            <div>{formatClockTime(item.at)}</div>
          </div>
          <div className="min-w-0">{renderItem(item, { t, units, locale, expanded, setExpanded })}</div>
        </li>
      ))}
    </ol>
  );
}

type Translator = ReturnType<typeof useTranslations>;

function renderItem(
  item: ReplayItem,
  ctx: {
    t: Translator;
    units: DurationUnits;
    locale: string;
    expanded: ReadonlySet<number>;
    setExpanded: (next: ReadonlySet<number>) => void;
  },
): ReactNode {
  const { t, units, locale, expanded, setExpanded } = ctx;
  switch (item.kind) {
    case "status":
      return <p className="text-sm text-muted-foreground">{statusLine(item, t)}</p>;
    case "user_message":
      return (
        <article className="rounded-lg border border-border bg-card px-3 py-2">
          <p className="text-xs font-medium text-muted-foreground">{t("timeline.userMessage")}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{item.text}</p>
          {item.attachments > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">{t("timeline.attachments", { count: item.attachments })}</p>
          ) : null}
        </article>
      );
    case "agent_message":
      return (
        <article className="rounded-lg border border-border bg-card px-3 py-2">
          <p className="text-xs font-medium text-muted-foreground">{t("timeline.agentMessage")}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{item.text}</p>
        </article>
      );
    case "thinking":
      return (
        <details className="rounded-lg border border-border bg-muted/40 px-3 py-2">
          <summary className="cursor-pointer text-sm text-muted-foreground">{t("timeline.thinking")}</summary>
          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{item.text}</p>
        </details>
      );
    case "tool":
      return (
        <details className="rounded-lg border border-border bg-card px-3 py-2">
          <summary className="cursor-pointer text-sm text-foreground">
            <span>{toolSummaryLabel(item, t)}</span>
            <span className="mx-2 text-muted-foreground">{item.name}</span>
            <ResultBadge item={item} t={t} />
            <span className="ml-2 text-xs text-muted-foreground">{formatDuration(item.result?.durationMs, units)}</span>
            {item.resolution ? (
              <span className="ml-2 text-xs text-muted-foreground">{resolutionLabel(item.resolution.result, t)}</span>
            ) : null}
          </summary>
          <div className="mt-3 space-y-3">
            <div>
              <p className="text-xs text-muted-foreground">{t("timeline.input")}</p>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs text-foreground">
                {formatInput(item.input)}
              </pre>
            </div>
            {item.result ? (
              <div>
                <p className="text-xs text-muted-foreground">{t("timeline.result")}</p>
                <pre className="mt-1 whitespace-pre-wrap break-all text-sm text-foreground">
                  {clipText(item.result.text, expanded.has(item.seq))}
                </pre>
                {item.result.text.length > TOOL_TEXT_PREVIEW_CHARS && !expanded.has(item.seq) ? (
                  <button
                    type="button"
                    className="mt-2 text-xs text-primary"
                    onClick={() => {
                      const next = new Set(expanded);
                      next.add(item.seq);
                      setExpanded(next);
                    }}
                  >
                    {t("timeline.expand")}
                  </button>
                ) : null}
              </div>
            ) : null}
            {item.resolution?.message ? (
              <p className="text-sm text-destructive">{item.resolution.message}</p>
            ) : null}
          </div>
        </details>
      );
    case "model_request":
      return (
        <p className={item.isError ? "text-sm text-destructive" : "text-sm text-foreground"}>
          {t("timeline.modelRequest")} · {item.model} · {formatDuration(item.durationMs, units)}
          {item.usage
            ? ` · ${t("detail.inputTokens")} ${formatCount(item.usage.input, locale)} / ${t("detail.outputTokens")} ${formatCount(item.usage.output, locale)}`
            : ""}
        </p>
      );
    case "usage":
      return (
        <p className="text-sm text-muted-foreground">
          {t("timeline.usage")} · {t("detail.inputTokens")} {formatCount(item.usage.input_tokens ?? 0, locale)} /{" "}
          {t("detail.outputTokens")} {formatCount(item.usage.output_tokens ?? 0, locale)} · {t("detail.toolCalls")}{" "}
          {formatCount(item.usage.tool_calls ?? 0, locale)} · {t("detail.runtime")}{" "}
          {formatDuration(item.usage.runtime_ms, units)}
        </p>
      );
    case "error":
      return (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <p className="font-medium">{item.errorType || t("timeline.error")}</p>
          <p className="mt-1 whitespace-pre-wrap">{item.message}</p>
          {item.retry ? <p className="mt-1 text-xs">{item.retry}</p> : null}
        </div>
      );
    case "interrupt":
      return <p className="text-sm text-foreground">{t("timeline.interrupt")}</p>;
    case "other":
      return <p className="text-sm text-muted-foreground">{item.type}</p>;
    default: {
      const _exhaustive: never = item;
      return null;
    }
  }
}

function statusLine(item: Extract<ReplayItem, { kind: "status" }>, t: Translator): string {
  const reason = stopReasonText(item.stopReason, t);
  switch (item.status) {
    case "running":
      return t("timeline.statusRunning");
    case "idle":
      return reason ? `${t("timeline.statusIdle")} · ${reason}` : t("timeline.statusIdle");
    case "terminated":
      return t("timeline.statusTerminated");
    default: {
      const _exhaustive: never = item.status;
      return _exhaustive;
    }
  }
}

function toolSummaryLabel(item: Extract<ReplayItem, { kind: "tool" }>, t: Translator): string {
  switch (item.toolType) {
    case "builtin":
      return t("timeline.tool");
    case "mcp":
      return item.server ? `${t("timeline.mcpTool")} · ${item.server}` : t("timeline.mcpTool");
    case "custom":
      return t("timeline.customTool");
    default: {
      const _exhaustive: never = item.toolType;
      return _exhaustive;
    }
  }
}

function ResultBadge({ item, t }: { item: Extract<ReplayItem, { kind: "tool" }>; t: Translator }) {
  if (!item.result) {
    return <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t("timeline.pending")}</span>;
  }
  if (item.result.isError) {
    return <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">{t("timeline.failed")}</span>;
  }
  return <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">{t("timeline.succeeded")}</span>;
}

function resolutionLabel(result: "allow" | "deny", t: Translator): string {
  switch (result) {
    case "allow":
      return t("timeline.allowed");
    case "deny":
      return t("timeline.denied");
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}

function stopReasonText(type: string | null, t: Translator): string | null {
  if (!type) return null;
  if ((MA_STOP_REASONS as readonly string[]).includes(type)) return t(`stopReason.${type}`);
  return type;
}

function formatInput(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2) ?? "null";
  } catch {
    return String(input);
  }
}

function clipText(text: string, expanded: boolean): string {
  if (expanded || text.length <= TOOL_TEXT_PREVIEW_CHARS) return text;
  return `${text.slice(0, TOOL_TEXT_PREVIEW_CHARS)}…`;
}

function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}
