import type { Message } from "../../store";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  BarChart3,
  FileText,
  Film,
  ListChecks,
  Plug,
  Search,
  ShieldAlert,
  Terminal,
  Wrench,
} from "lucide-react";

import { Shimmer } from "../ds/Shimmer";
import { ToolOutputStream } from "./ToolOutputStream";
import { SkillPatchPreviewCard } from "./SkillPatchPreviewCard";
import { WidgetBlock } from "./WidgetBlock";
import {
  parseSkillManageError,
  parseSkillPatchPreviewPayload,
  type SkillPatchPreviewPayload,
} from "./skill-manage-preview";
import { parseWidgetPayload, isBrokenStockChartAttempt, stockChartDegradedMessage } from "./widget-preview";
import { openExternalUrl } from "../../utils/open-external";
import { isHookBlockedToolMessage } from "../../utils/hook-block-message";

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
  onSkillManageApply?: (message: Message, payload: SkillPatchPreviewPayload, targetIndex: number | null) => void;
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
  if (name === "group_progress") {
    return String(message.toolResultPreview || message.content || "群聊成员处理中").trim();
  }
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
  if (name === "video_understand") {
    const p = String(args.path ?? "").trim();
    const base = p ? p.split(/[\\/]/).pop() : "";
    return base ? `理解视频 ${base}` : "理解视频";
  }
  if (name === "show_widget") {
    const argTitle = String(args.title ?? "").trim();
    if (argTitle) return argTitle;
    const parsed = parseWidgetPayload(message.content);
    if (parsed?.title) return parsed.title;
    return "可视化图表";
  }
  if (name) return name;
  return extractToolSummary(message.content);
}

function pickToolIcon(name: string) {
  if (name === "bash_exec") return Terminal;
  if (name === "file_read" || name === "file_write" || name === "file_edit") return FileText;
  if (name === "todo_write") return ListChecks;
  if (name === "mcp_call") return Plug;
  if (name === "knowledge_search") return Search;
  if (name === "video_understand") return Film;
  if (name === "show_widget") return BarChart3;
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

const TOOL_URL_RE = /(https?:\/\/[^\s<>"']+)/giu;
const TOOL_URL_TRAILING_PUNCT = /[.,;:!?)\]>}"']+$/;

function highlightTextSegment(text: string, terms: string[]): ReactNode {
  if (!text) return null;
  if (terms.length === 0) return text;
  const regex = new RegExp(`(${terms.map((t) => escapeRegExp(t)).join("|")})`, "giu");
  const parts = text.split(regex);
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

// URL 整体保持完整可点击，不被关键词高亮拆散；点击走系统默认浏览器。
function renderHighlightedText(content: string, terms: string[]): ReactNode {
  if (!content) return null;
  const segments: Array<{ type: "text" | "url"; value: string }> = [];
  let last = 0;
  TOOL_URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOOL_URL_RE.exec(content)) !== null) {
    const start = m.index;
    const raw = m[1];
    if (start > last) segments.push({ type: "text", value: content.slice(last, start) });
    const url = raw.replace(TOOL_URL_TRAILING_PUNCT, "");
    if (url) segments.push({ type: "url", value: url });
    last = start + raw.length;
    TOOL_URL_RE.lastIndex = last;
    if (raw.length === 0) break;
  }
  if (last < content.length) segments.push({ type: "text", value: content.slice(last) });

  if (segments.length === 0) return content;
  if (!segments.some((s) => s.type === "url")) return highlightTextSegment(content, terms);

  return segments.map((seg, i) => {
    if (seg.type === "url") {
      return (
        <a
          key={`tool-link-${i}`}
          href={seg.value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan-600 underline underline-offset-2 break-all hover:text-cyan-500 dark:text-cyan-400 dark:hover:text-cyan-300"
          onClick={(e) => {
            e.preventDefault();
            openExternalUrl(seg.value);
          }}
        >
          {seg.value}
        </a>
      );
    }
    return <span key={`tool-text-${i}`}>{highlightTextSegment(seg.value, terms)}</span>;
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
  onSkillManageApply,
}: Props) {
  const normalizedTerms = useMemo(() => normalizeHighlightTerms(highlightTerms), [highlightTerms]);
  const isHookBlocked = useMemo(() => isHookBlockedToolMessage(message), [message.content, message.toolStatus]);
  const widgetPayload = useMemo(() => {
    if ((message.toolName ?? "").trim() !== "show_widget") return null;
    return parseWidgetPayload(message.content);
  }, [message.toolName, message.content]);
  const matchedByHighlight = useMemo(() => {
    if (!message.content || normalizedTerms.length === 0) return false;
    const hay = message.content.toLocaleLowerCase();
    return normalizedTerms.some((t) => hay.includes(t.toLocaleLowerCase()));
  }, [message.content, normalizedTerms]);
  const shouldForceExpand = forceExpand || matchedByHighlight;
  const [expanded, setExpanded] = useState(shouldForceExpand);

  const title = useMemo(() => buildToolCardTitle(message), [message]);
  const toolName = (message.toolName ?? "").trim();

  // show_widget with valid payload → render inline (no collapsible chrome)
  if (toolName === "show_widget" && widgetPayload) {
    return (
      <div className="w-full min-w-0 px-4">
        <WidgetBlock payload={widgetPayload} />
      </div>
    );
  }

  // show_widget with truncated/broken content → amber warning inline
  if (toolName === "show_widget" && /\[micro-compact tool=show_widget/i.test(message.content)) {
    return (
      <div className="w-full min-w-0 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
        图表内容被上下文压缩截断，无法渲染。请重新生成或升级 Near 后重试本对话。
      </div>
    );
  }

  if (toolName === "show_widget" && isBrokenStockChartAttempt(message.content) && !widgetPayload) {
    return (
      <div className="w-full min-w-0 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
        {stockChartDegradedMessage()}
      </div>
    );
  }
  const Icon = isHookBlocked
    ? ShieldAlert
    : pickToolIcon(toolName || extractToolSummary(message.content).split(/\s/)[0] || "tool");
  const status = message.toolStatus;
  const hasStream = (message.toolStreamLines?.length ?? 0) > 0;
  const hasDetail = !isHookBlocked && (message.content.length > 0 || hasStream);
  const skillPreviewPayload = useMemo(() => {
    if ((message.toolName ?? "").trim() !== "skill_manage") return null;
    return parseSkillPatchPreviewPayload(message.content);
  }, [message.toolName, message.content]);
  const skillManageError = useMemo(() => {
    if ((message.toolName ?? "").trim() !== "skill_manage") return null;
    return parseSkillManageError(message.content);
  }, [message.toolName, message.content]);

  const iconColorClass = isHookBlocked ? "text-amber-400" : iconTone(status);

  const titleEl = isHookBlocked ? (
    <span className="inline-flex min-w-0 flex-1 items-baseline gap-1.5 truncate">
      <span className="min-w-0 truncate text-[13px] font-medium text-text-subtle">{title}</span>
      <span className="shrink-0 rounded-[4px] bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-400">
        Hook 拦截
      </span>
    </span>
  ) : status === "running" || status === "pending" ? (
    <Shimmer text={title} className="text-[13px] font-medium" />
  ) : (
    <span className="text-[13px] font-medium text-text-subtle">{title}</span>
  );

  const sec = message.toolElapsedSec;
  const metaRight =
    sec != null && Number.isFinite(sec) && (status === "running" || status === "pending") ? (
      <span className="shrink-0 text-[12px] text-text-faint tabular-nums">{sec}s</span>
    ) : null;

  useEffect(() => {
    if (shouldForceExpand) setExpanded(true);
  }, [shouldForceExpand]);

  const expandedDetailClass =
    variant === "flat"
      ? "space-y-1 px-3 pb-2 pt-0.5 text-[13px] leading-[1.7]"
      : variant === "nested"
        ? "mt-1.5 space-y-1 pl-3 text-[13px] leading-[1.7]"
        : "space-y-1 border-t border-border px-3 pb-2 pt-1.5 text-[13px] leading-[1.7]";
  const forcedActionClass =
    variant === "flat"
      ? "px-3 pb-2 pt-0.5"
      : variant === "nested"
        ? "mt-1.5 pl-3"
        : "border-t border-border px-3 pb-2 pt-1.5";

  const detailBody = (
    <>
      {hasStream ? <ToolOutputStream lines={message.toolStreamLines ?? []} /> : null}
      {skillPreviewPayload ? (
        <SkillPatchPreviewCard
          message={message}
          payload={skillPreviewPayload}
          onApply={onSkillManageApply}
        />
      ) : null}
      {skillManageError ? (
        <div
          className={`rounded border px-2 py-1 text-[12px] ${
            skillManageError.code === "POLICY"
              ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
              : "border-rose-500/50 bg-rose-500/10 text-rose-300"
          }`}
        >
          <div className="font-medium">
            {skillManageError.code === "POLICY" ? "安全策略拦截" : "参数/状态校验失败"}
          </div>
          {skillManageError.detail ? (
            <div className="mt-0.5 whitespace-pre-wrap break-words text-[11px] text-current/90">
              {skillManageError.detail}
            </div>
          ) : null}
        </div>
      ) : null}
      {message.content && !isHookBlocked && !skillPreviewPayload && !skillManageError && !widgetPayload ? (
        <span className="break-all whitespace-pre-wrap">
          {renderHighlightedText(message.content, normalizedTerms)}
        </span>
      ) : null}
      {action}
    </>
  );

  const shellOuterClass =
    variant === "nested"
      ? "relative w-full min-w-0 text-[13px] text-text-muted"
      : variant === "flat"
        ? "w-full min-w-0 overflow-hidden text-[13px] text-text-muted"
        : `w-full min-w-0 overflow-hidden rounded-lg border bg-surface-card text-[13px] text-text-muted transition ${
            selected
              ? "border-[rgba(var(--theme-color-rgb,6,182,212),0.6)]"
              : isHookBlocked
                ? "border-amber-500/30"
                : "border-border"
          }`;

  const shell =
    variant === "nested" ? (
      <div className={shellOuterClass}>
        {/* 与 TurnToolGroupCard 左侧虚线对齐（父容器 px-3 12px + 10px = 22px） */}
        <div
          className="pointer-events-none absolute left-[10px] top-[15px] z-[2] h-2 w-2 -translate-x-1/2 rounded-full border-2 border-surface-card bg-border"
          aria-hidden
        />
        <div className="ml-[28px] min-w-0">
          <button
            type="button"
            className={`group inline-flex max-w-full items-center gap-2 rounded-full border border-border/70 bg-zinc-100/60 px-3 py-1.5 text-left shadow-sm transition hover:bg-zinc-200/60 disabled:cursor-default disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.05] ${
              selected ? "ring-1 ring-[rgba(var(--theme-color-rgb,6,182,212),0.55)]" : ""
            }`}
            onClick={() => hasDetail && setExpanded((v) => !v)}
            disabled={!hasDetail}
          >
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-transparent">
              <Icon className={`h-3 w-3 ${iconColorClass}`} aria-hidden />
            </span>
            <span className="min-w-0 shrink truncate text-left">{titleEl}</span>
            {metaRight}
            {hasDetail ? (
              expanded ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2} aria-hidden />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2} aria-hidden />
              )
            ) : null}
          </button>

          {expanded && <div className={expandedDetailClass}>{detailBody}</div>}
          {!expanded && shouldForceExpand && action && <div className={forcedActionClass}>{action}</div>}
        </div>
      </div>
    ) : variant === "flat" ? (
      <div className={shellOuterClass}>
        <button
          type="button"
          className="relative z-[1] inline-flex w-full max-w-full items-center gap-2 px-3 py-1 text-left disabled:cursor-default disabled:opacity-60"
          onClick={() => hasDetail && setExpanded((v) => !v)}
          disabled={!hasDetail}
        >
          <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center" aria-hidden>
            <Icon className={`h-3.5 w-3.5 ${iconColorClass}`} aria-hidden />
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-left">{titleEl}</span>
            {metaRight}
          </span>
          {hasDetail ? (
            expanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2} aria-hidden />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2} aria-hidden />
            )
          ) : null}
        </button>

        {expanded && (
          <div className={expandedDetailClass}>
            <div className="pl-[28px]">{detailBody}</div>
          </div>
        )}

        {!expanded && shouldForceExpand && action && <div className={forcedActionClass}>{action}</div>}
      </div>
    ) : (
      <div className={shellOuterClass}>
        <div className={`flex w-full items-center gap-1.5 px-3 py-3 text-left`}>
          <button
            type="button"
            className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-left disabled:cursor-default disabled:opacity-60"
            onClick={() => hasDetail && setExpanded((v) => !v)}
            disabled={!hasDetail}
          >
            {hasDetail &&
              (expanded ? (
                <ChevronDown className="h-3 w-3 shrink-0 text-text-muted" strokeWidth={2} aria-hidden />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0 text-text-muted" strokeWidth={2} aria-hidden />
              ))}
            <Icon className={`h-3.5 w-3.5 shrink-0 ${iconColorClass}`} />
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
