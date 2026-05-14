import type { Message } from "../../store";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  ListChecks,
  Plug,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import { Shimmer } from "../ds/Shimmer";
import { ToolOutputStream } from "./ToolOutputStream";

type Props = {
  message: Message;
  action?: ReactNode;
  /** Nested inside TurnToolGroupCard — lighter chrome */
  variant?: "default" | "nested" | "flat";
  /** When true, remove left w-8 spacer (ReAct block already has avatar column). */
  omitLeadingSpacer?: boolean;
  /** 有需要用户操作的内联确认时强制展开 */
  forceExpand?: boolean;
  /** 历史搜索关键词高亮（命中时自动展开） */
  highlightTerms?: string[];
  /** 多选模式 */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelectMessage?: (message: Message) => void;
};

/** Legacy: extract tool name from old 🔧/✅ prefixed content */
function extractToolSummary(content: string): string {
  const toolMatch = content.match(/^🔧\s+([^:]+)/);
  if (toolMatch) return toolMatch[1].trim();
  const emojiMatch = content.match(/^([⚠️❌🗣✅])\s+(.{0,60})/u);
  if (emojiMatch) return emojiMatch[2].trim();
  return content.slice(0, 60).replace(/\n/g, " ").trim();
}

export function buildToolCardTitle(message: Message): string {
  const name = (message.toolName ?? "").trim();
  const args = message.toolArgs ?? {};
  if (name === "file_read" || name === "file_write" || name === "file_edit") {
    const p = String(args.path ?? "").trim();
    const sl = args.start_line;
    const el = args.end_line;
    if (p && sl != null && el != null) return `Read ${p} L${sl}-${el}`;
    if (p) return `${name} ${p}`;
  }
  if (name === "bash_exec") {
    const cmd = String(args.command ?? "").replace(/\s+/g, " ").trim();
    if (!cmd) return "bash_exec";
    return cmd.length > 80 ? `${cmd.slice(0, 80)}…` : cmd;
  }
  if (name === "todo_write") return "todo_write";
  if (name === "mcp_call") {
    const tn = String(args.tool_name ?? "").trim();
    return tn ? `mcp_call ${tn}` : "mcp_call";
  }
  if (name === "knowledge_search") return "knowledge_search";
  if (name) return name;
  return extractToolSummary(message.content);
}

function pickToolIcon(name: string) {
  if (name === "bash_exec") return Terminal;
  if (name === "file_read" || name === "file_write" || name === "file_edit") return FileText;
  if (name === "todo_write") return ListChecks;
  if (name === "mcp_call") return Plug;
  if (name === "knowledge_search") return Search;
  return Wrench;
}

function iconTone(st: Message["toolStatus"]): string {
  if (st === "done") return "text-emerald-400";
  if (st === "error") return "text-rose-400";
  if (st === "cancelled") return "text-text-faint";
  if (st === "running" || st === "pending") return "text-cyan-400";
  return "text-text-subtle";
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeHighlightTerms(terms?: string[]): string[] {
  if (!terms || terms.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const t = String(raw || "").trim();
    if (t.length < 2) continue;
    const key = t.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  out.sort((a, b) => b.length - a.length);
  return out;
}

function renderHighlightedText(content: string, terms: string[]): ReactNode {
  if (!content) return null;
  if (terms.length === 0) return content;
  const regex = new RegExp(`(${terms.map((t) => escapeRegExp(t)).join("|")})`, "giu");
  const parts = content.split(regex);
  return parts.map((part, idx) => {
    if (!part) return null;
    regex.lastIndex = 0;
    const matched = regex.test(part);
    if (!matched) return <span key={`tool-part-${idx}`}>{part}</span>;
    return (
      <mark key={`tool-part-${idx}`} data-agx-highlight="1" className="agx-keyword-highlight rounded px-[1px]">
        {part}
      </mark>
    );
  });
}

export function ToolCallCard({
  message,
  action,
  variant = "default",
  forceExpand = false,
  omitLeadingSpacer = false,
  highlightTerms,
  selectable,
  selected,
  onToggleSelectMessage,
}: Props) {
  const normalizedTerms = useMemo(() => normalizeHighlightTerms(highlightTerms), [highlightTerms]);
  const matchedByHighlight = useMemo(() => {
    if (!message.content || normalizedTerms.length === 0) return false;
    const hay = message.content.toLocaleLowerCase();
    return normalizedTerms.some((t) => hay.includes(t.toLocaleLowerCase()));
  }, [message.content, normalizedTerms]);
  const shouldForceExpand = forceExpand || matchedByHighlight;
  const [expanded, setExpanded] = useState(shouldForceExpand);

  const title = useMemo(() => buildToolCardTitle(message), [message]);
  const toolName = (message.toolName ?? "").trim();
  const Icon = pickToolIcon(toolName || extractToolSummary(message.content).split(/\s/)[0] || "tool");
  const status = message.toolStatus;
  const hasStream = (message.toolStreamLines?.length ?? 0) > 0;
  const hasDetail = message.content.length > 0 || hasStream;

  const titleEl =
    status === "running" || status === "pending" ? (
      <Shimmer text={title} className="text-xs font-medium" />
    ) : (
      <span className="text-xs font-medium text-text-subtle">{title}</span>
    );

  const sec = message.toolElapsedSec;
  const metaRight =
    sec != null && Number.isFinite(sec) && (status === "running" || status === "pending") ? (
      <span className="shrink-0 text-[11px] text-text-faint tabular-nums">{sec}s</span>
    ) : null;

  useEffect(() => {
    if (shouldForceExpand) setExpanded(true);
  }, [shouldForceExpand]);

  const expandedDetailClass =
    variant === "flat"
      ? "space-y-1 px-3 pb-2 pt-0.5"
      : variant === "nested"
        ? "mt-1.5 space-y-1 pl-3 text-[11px] leading-relaxed"
        : "space-y-1 border-t border-border px-3 pb-2 pt-1.5";
  const forcedActionClass =
    variant === "flat"
      ? "px-3 pb-2 pt-0.5"
      : variant === "nested"
        ? "mt-1.5 pl-3"
        : "border-t border-border px-3 pb-2 pt-1.5";

  const detailBody = (
    <>
      {hasStream ? <ToolOutputStream lines={message.toolStreamLines ?? []} /> : null}
      {message.content ? (
        <span className="break-all whitespace-pre-wrap">
          {renderHighlightedText(message.content, normalizedTerms)}
        </span>
      ) : null}
      {action}
    </>
  );

  const shellOuterClass =
    variant === "nested"
      ? "relative w-full min-w-0 text-xs text-text-muted"
      : variant === "flat"
        ? "w-full min-w-0 overflow-hidden text-xs text-text-muted"
        : `w-full min-w-0 overflow-hidden rounded-lg border bg-surface-card text-xs text-text-muted transition ${
            selected ? "border-[rgba(var(--theme-color-rgb,6,182,212),0.6)]" : "border-border"
          }`;

  const shell =
    variant === "nested" ? (
      <div className={shellOuterClass}>
        {/* 与 TurnToolGroupCard 左侧虚线对齐（父容器 px-3 12px + 8px = 20px） */}
        <div
          className="pointer-events-none absolute left-[8px] top-[15px] z-[2] h-2 w-2 -translate-x-1/2 rounded-full border-2 border-surface-card bg-border"
          aria-hidden
        />
        <div className="ml-6 min-w-0">
          <button
            type="button"
            className={`group inline-flex max-w-full items-center gap-2 rounded-full border border-border/70 bg-zinc-100/60 px-3 py-1.5 text-left shadow-sm transition hover:bg-zinc-200/60 disabled:cursor-default disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.05] ${
              selected ? "ring-1 ring-[rgba(var(--theme-color-rgb,6,182,212),0.55)]" : ""
            }`}
            onClick={() => hasDetail && setExpanded((v) => !v)}
            disabled={!hasDetail}
          >
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-transparent">
              <Icon className={`h-3 w-3 ${iconTone(status)}`} aria-hidden />
            </span>
            <span className="min-w-0 shrink truncate text-left">{titleEl}</span>
            {metaRight}
            {hasDetail ? (
              expanded ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
              )
            ) : null}
          </button>

          {expanded && <div className={expandedDetailClass}>{detailBody}</div>}
          {!expanded && shouldForceExpand && action && <div className={forcedActionClass}>{action}</div>}
        </div>
      </div>
    ) : (
      <div className={shellOuterClass}>
        <div className="flex w-full items-center gap-1.5 px-3 py-2 text-left">
          <button
            type="button"
            className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-left disabled:cursor-default disabled:opacity-60"
            onClick={() => hasDetail && setExpanded((v) => !v)}
            disabled={!hasDetail}
          >
            {hasDetail &&
              (expanded ? (
                <ChevronDown className="h-3 w-3 shrink-0 text-text-muted" aria-hidden />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0 text-text-muted" aria-hidden />
              ))}
            <Icon className={`h-3.5 w-3.5 shrink-0 ${iconTone(status)}`} />
            <span className="min-w-0 flex-1 truncate">{titleEl}</span>
            {metaRight}
          </button>
        </div>

        {expanded && <div className={expandedDetailClass}>{detailBody}</div>}

        {!expanded && shouldForceExpand && action && <div className={forcedActionClass}>{action}</div>}
      </div>
    );

  if (variant === "nested" || (variant === "flat" && omitLeadingSpacer)) {
    return <div className="min-w-0 w-full">{shell}</div>;
  }

  return (
    <div className="flex min-w-0 items-start gap-2">
      {selectable && (
        <button
          type="button"
          className={`mt-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${
            selected
              ? "border-[rgb(var(--theme-color-rgb,6,182,212))] bg-[rgb(var(--theme-color-rgb,6,182,212))] text-white"
              : "border-text-faint bg-transparent text-transparent"
          }`}
          onClick={() => onToggleSelectMessage?.(message)}
          aria-label={selected ? "取消选择" : "选择此工具消息"}
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
          </svg>
        </button>
      )}

      <div className="flex min-w-0 flex-1 justify-start gap-2">
        <div className="flex min-w-0 flex-1 flex-row gap-2">
          <div className="flex min-w-0 flex-1 flex-col items-start">
            {shell}
          </div>
        </div>
      </div>
    </div>
  );
}
