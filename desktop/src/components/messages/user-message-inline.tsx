import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { SkillPuzzleIcon } from "../icons/SkillPuzzleIcon";
import {
  COMPOSER_INLINE_CHIP_CLASS,
  ComposerRefIcon,
  resolveComposerRefIconKindFromAttachments,
} from "../icons/ComposerRefIcon";
import { ComposerQuoteIcon, formatQuoteChipLabel } from "../icons/ComposerQuoteIcon";
import type { Components } from "react-markdown";
import type { MessageAttachment } from "../../store";
import {
  buildFileReferenceOpenRequest,
  findReferenceAttachmentMeta,
  matchReferenceMentionLabel,
  normalizeReferenceAttachments,
  parseLineRangeFromReferenceLabel,
  resolveAttachmentLineRange,
  type FileReferenceOpenRequest,
} from "../../utils/reference-attachment";
import { HoverTip } from "../ds/HoverTip";
import {
  fileNameFromPath,
  formatReferenceChipLabel,
  resolveReferenceSourcePath,
} from "../../utils/chat-file-mention";
import {
  chatMarkdownComponents,
  chatRehypePlugins,
  chatRemarkPlugins,
  chatUrlTransform,
  normalizeChatMarkdownContent,
} from "./markdown-components";
import { maskSecretsForDisplay } from "../../utils/secret-mask";
import {
  bodyHasInlineQuotePlaceholders,
  indexOfNextComposerQuotePlaceholder,
  matchComposerQuotePlaceholder,
  normalizeInlineQuoteBodyForDisplay,
  resolveInlineQuoteDisplayText,
} from "../../utils/user-quote-display";

const SKILL_PREFIX = "@skill://";

/** Aligned with ChatPane sendChat slug extraction. */
const SKILL_SLUG_RE = /^([^\s@,，。！？\n]+)/;

const userInlineMarkdownComponents: Partial<Components> = {
  ...chatMarkdownComponents,
  p: ({ children }) => <span className="inline">{children}</span>,
};

function tryConsumeSkillRef(text: string, at: number): { slug: string; len: number } | null {
  if (!text.startsWith(SKILL_PREFIX, at)) return null;
  const after = text.slice(at + SKILL_PREFIX.length);
  const m = after.match(SKILL_SLUG_RE);
  if (!m) return null;
  const slug = m[1];
  return { slug, len: SKILL_PREFIX.length + slug.length };
}

export function UserSkillRefChip({ name }: { name: string }) {
  return (
    <span className={COMPOSER_INLINE_CHIP_CLASS} title={`@skill://${name}`}>
      <SkillPuzzleIcon className="agx-composer-inline-chip-icon h-[0.95em] w-[0.95em] shrink-0 opacity-90" />
      <span className="min-w-0 truncate">{name}</span>
    </span>
  );
}

/** Cursor-style compact quote pill inside a sent user bubble. */
export function UserQuoteRefChip({ quoted }: { quoted: string }) {
  const full = String(quoted || "").trim();
  if (!full) return null;
  return (
    <span
      className={`${COMPOSER_INLINE_CHIP_CLASS} agx-composer-quote-chip`}
      title={full}
    >
      <ComposerQuoteIcon />
      <span className="agx-composer-quote-chip-label">{formatQuoteChipLabel(full)}</span>
    </span>
  );
}

function truncateSnippetId(id: string, maxLen = 16): string {
  const raw = String(id || "").trim();
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, Math.max(8, maxLen - 1))}…`;
}

function parseSnippetIdFromLabel(label: string): string {
  const m = String(label || "")
    .trim()
    .match(/:(el-snippet-[a-z0-9]+)$/i);
  return m?.[1] ?? "";
}

export function UserFileRefChip({
  name,
  referenceAttachments = [],
  onOpenReference,
}: {
  name: string;
  referenceAttachments?: MessageAttachment[];
  onOpenReference?: (request: FileReferenceOpenRequest) => void;
}) {
  const meta = findReferenceAttachmentMeta(name, referenceAttachments);
  const sourcePath = String(meta?.sourcePath || "").trim();
  const lineRange =
    (meta ? resolveAttachmentLineRange(meta) : undefined) ??
    parseLineRangeFromReferenceLabel(name);
  const htmlEl = meta?.htmlElementRef;
  const htmlComment = String(htmlEl?.comment || "").trim();
  const snippetId =
    String(meta?.snippetRef || "").trim() || parseSnippetIdFromLabel(name) || parseSnippetIdFromLabel(meta?.name || "");
  const fileBasename = sourcePath
    ? fileNameFromPath(sourcePath)
    : formatReferenceChipLabel(name, sourcePath, lineRange)
        .replace(/\s*\(\d+-\d+\)\s*$/, "")
        .replace(/:el-snippet-[a-z0-9]+$/i, "");
  const baseName = htmlEl || snippetId
    ? fileBasename || String(htmlEl?.tagName || meta?.composerRefLabel || name).trim()
    : formatReferenceChipLabel(name, sourcePath, lineRange).replace(
        /\s*\(\d+-\d+\)\s*$/,
        ""
      );
  const lineLabel =
    lineRange && lineRange.start === lineRange.end
      ? `:${lineRange.start}`
      : lineRange
        ? `:${lineRange.start}-${lineRange.end}`
        : "";
  const resolvedPath = resolveReferenceSourcePath(name, sourcePath);
  const kind = htmlEl || snippetId
    ? "file"
    : resolveComposerRefIconKindFromAttachments(name, referenceAttachments);
  const openRequest = buildFileReferenceOpenRequest(name, meta);
  const clickable = !!openRequest && !!onOpenReference;
  const hoverTitle = resolvedPath
    ? [
        resolvedPath,
        snippetId || null,
        lineRange
          ? `第 ${lineRange.start}${lineRange.end !== lineRange.start ? `–${lineRange.end}` : ""} 行`
          : null,
        htmlComment || null,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  // Element / snippet chip: file · muted id（必要时再跟 comment）
  const chipInner = htmlEl || snippetId ? (
    <>
      <ComposerRefIcon kind={kind} />
      <span className="agx-file-ref-chip-name">{baseName}</span>
      {snippetId ? (
        <>
          <span className="agx-file-ref-chip-sep">·</span>
          <span className="agx-file-ref-chip-meta">{truncateSnippetId(snippetId)}</span>
        </>
      ) : null}
      {htmlComment ? (
        <>
          <span className="agx-file-ref-chip-sep">·</span>
          <span className="agx-file-ref-chip-meta">{htmlComment}</span>
        </>
      ) : null}
    </>
  ) : (
    <>
      <ComposerRefIcon kind={kind} />
      <span className="agx-file-ref-chip-name">{baseName}</span>
      {lineLabel ? <span className="agx-file-ref-chip-lines">{lineLabel}</span> : null}
    </>
  );

  const chip = clickable ? (
    <button
      type="button"
      className={`${COMPOSER_INLINE_CHIP_CLASS} cursor-pointer transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--theme-color-rgb,16,185,129),0.45)]`}
      title={hoverTitle ?? "点击预览文件"}
      onClick={(event) => {
        event.stopPropagation();
        if (openRequest) onOpenReference?.(openRequest);
      }}
    >
      {chipInner}
    </button>
  ) : (
    <span className={COMPOSER_INLINE_CHIP_CLASS} title={hoverTitle}>
      {chipInner}
    </span>
  );

  if (!resolvedPath) return chip;
  return (
    <HoverTip label={resolvedPath} inline delayMs={280}>
      {chip}
    </HoverTip>
  );
}

/**
 * Renders user message body with @skill://… chips and @file reference chips; text runs through markdown.
 */
export function renderUserMessageInlineBody(
  bodyText: string,
  referenceAttachments: MessageAttachment[],
  onOpenFileReference?: (request: FileReferenceOpenRequest) => void,
  quotedItems: string[] = []
): ReactNode {
  const refs = normalizeReferenceAttachments(referenceAttachments) ?? [];

  const chunks: ReactNode[] = [];
  let cursor = 0;
  let mdKey = 0;

  const pushMarkdown = (raw: string) => {
    if (!raw) return;
    chunks.push(
      <ReactMarkdown
        key={`umd-${mdKey++}`}
        remarkPlugins={chatRemarkPlugins}
        rehypePlugins={chatRehypePlugins}
        components={userInlineMarkdownComponents}
        urlTransform={chatUrlTransform}
      >
        {normalizeChatMarkdownContent(maskSecretsForDisplay(raw))}
      </ReactMarkdown>
    );
  };

  let chipKey = 0;
  while (cursor < bodyText.length) {
    const quotePhAtCursor = matchComposerQuotePlaceholder(bodyText, cursor);
    if (quotePhAtCursor) {
      const quoted =
        resolveInlineQuoteDisplayText(quotePhAtCursor.id, quotedItems) || "引用";
      chunks.push(<UserQuoteRefChip key={`q-${chipKey++}`} quoted={quoted} />);
      cursor += quotePhAtCursor.len;
      continue;
    }

    // Break on the nearest @mention OR inline quote placeholder (not only @).
    const nextQuote = indexOfNextComposerQuotePlaceholder(bodyText, cursor);
    const nextAt = bodyText.indexOf("@", cursor);
    let nextSpecial = -1;
    if (nextQuote >= 0 && nextAt >= 0) nextSpecial = Math.min(nextQuote, nextAt);
    else nextSpecial = nextQuote >= 0 ? nextQuote : nextAt;

    if (nextSpecial < 0) {
      pushMarkdown(bodyText.slice(cursor));
      break;
    }
    if (nextSpecial > cursor) {
      pushMarkdown(bodyText.slice(cursor, nextSpecial));
    }
    cursor = nextSpecial;

    const quotePh = matchComposerQuotePlaceholder(bodyText, cursor);
    if (quotePh) {
      const quoted = resolveInlineQuoteDisplayText(quotePh.id, quotedItems) || "引用";
      chunks.push(<UserQuoteRefChip key={`q-${chipKey++}`} quoted={quoted} />);
      cursor += quotePh.len;
      continue;
    }

    const sk = tryConsumeSkillRef(bodyText, cursor);
    if (sk) {
      chunks.push(<UserSkillRefChip key={`sk-${chipKey++}`} name={sk.slug} />);
      cursor += sk.len;
      continue;
    }

    const rest = bodyText.slice(cursor + 1);
    const matched = matchReferenceMentionLabel(rest, refs);
    if (matched) {
      chunks.push(
        <UserFileRefChip
          key={`ref-${chipKey++}`}
          name={matched}
          referenceAttachments={refs}
          onOpenReference={onOpenFileReference}
        />
      );
      cursor += matched.length + 1;
      continue;
    }

    pushMarkdown(bodyText.slice(cursor, cursor + 1));
    cursor += 1;
  }

  return chunks.length > 0 ? <>{chunks}</> : null;
}

/** User bubble body: inline quote chips follow placeholder order when present. */
export function renderUserBubbleInlineContent(
  bodyText: string,
  quotedItems: string[],
  referenceAttachments: MessageAttachment[],
  onOpenFileReference?: (request: FileReferenceOpenRequest) => void
): ReactNode {
  const normalized = normalizeInlineQuoteBodyForDisplay(bodyText, quotedItems);
  const trimmed = String(normalized || "").trim();
  if (bodyHasInlineQuotePlaceholders(normalized) && normalized.includes("[[agx-quote:")) {
    return renderUserMessageInlineBody(
      normalized,
      referenceAttachments,
      onOpenFileReference,
      quotedItems
    );
  }
  if (quotedItems.length > 0) {
    return (
      <>
        {quotedItems.map((quoted, idx) => (
          <span key={`q-legacy-${idx}-${quoted.slice(0, 12)}`}>
            <UserQuoteRefChip quoted={quoted} />
            {idx < quotedItems.length - 1 || trimmed ? " " : null}
          </span>
        ))}
        {trimmed
          ? renderUserMessageInlineBody(trimmed, referenceAttachments, onOpenFileReference)
          : null}
      </>
    );
  }
  return trimmed
    ? renderUserMessageInlineBody(trimmed, referenceAttachments, onOpenFileReference)
    : null;
}