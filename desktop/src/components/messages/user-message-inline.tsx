import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { SkillPuzzleIcon } from "../icons/SkillPuzzleIcon";
import {
  COMPOSER_INLINE_CHIP_CLASS,
  ComposerRefIcon,
  resolveComposerRefIconKindFromAttachments,
} from "../icons/ComposerRefIcon";
import type { Components } from "react-markdown";
import type { MessageAttachment } from "../../store";
import { normalizeReferenceAttachments } from "../../utils/reference-attachment";
import {
  formatReferenceChipLabel,
  referenceChipTitle,
} from "../../utils/chat-file-mention";
import {
  chatMarkdownComponents,
  chatRehypePlugins,
  chatRemarkPlugins,
  chatUrlTransform,
  normalizeChatMarkdownContent,
} from "./markdown-components";

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

export function UserFileRefChip({
  name,
  referenceAttachments = [],
}: {
  name: string;
  referenceAttachments?: MessageAttachment[];
}) {
  const meta = referenceAttachments.find(
    (att) =>
      att.composerRefLabel === name ||
      att.name === name ||
      att.sourcePath === name ||
      String(att.name || "")
        .split(/[\\/]/)
        .pop() === name
  );
  const sourcePath = String(meta?.sourcePath || "").trim();
  const displayLabel = formatReferenceChipLabel(name, sourcePath);
  const kind = resolveComposerRefIconKindFromAttachments(name, referenceAttachments);
  return (
    <span className={COMPOSER_INLINE_CHIP_CLASS} title={referenceChipTitle(name, sourcePath)}>
      <ComposerRefIcon kind={kind} />
      <span className="min-w-0 truncate">{displayLabel}</span>
    </span>
  );
}

/**
 * Renders user message body with @skill://… chips and @file reference chips; text runs through markdown.
 */
export function renderUserMessageInlineBody(
  bodyText: string,
  referenceAttachments: MessageAttachment[]
): ReactNode {
  const refs = normalizeReferenceAttachments(referenceAttachments) ?? [];
  const names = Array.from(
    new Set(
      refs
        .flatMap((att) => {
          const label = String(att.composerRefLabel || att.name || "").trim();
          const sourcePath = String(att.sourcePath || "").trim();
          const base = sourcePath ? sourcePath.split(/[\\/]/).pop() || "" : "";
          return [label, sourcePath, base].filter((item) => item.length > 0);
        })
    )
  ).sort((a, b) => b.length - a.length);

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
        {normalizeChatMarkdownContent(raw)}
      </ReactMarkdown>
    );
  };

  let chipKey = 0;
  while (cursor < bodyText.length) {
    const nextAt = bodyText.indexOf("@", cursor);
    if (nextAt < 0) {
      pushMarkdown(bodyText.slice(cursor));
      break;
    }
    if (nextAt > cursor) {
      pushMarkdown(bodyText.slice(cursor, nextAt));
    }
    cursor = nextAt;

    const sk = tryConsumeSkillRef(bodyText, cursor);
    if (sk) {
      chunks.push(<UserSkillRefChip key={`sk-${chipKey++}`} name={sk.slug} />);
      cursor += sk.len;
      continue;
    }

    const rest = bodyText.slice(cursor + 1);
    const matched = names.find((name) => {
      if (!rest.startsWith(name)) return false;
      const tail = rest.slice(name.length, name.length + 1);
      return tail.length === 0 || /\s/.test(tail);
    });
    if (matched) {
      chunks.push(
        <UserFileRefChip
          key={`ref-${chipKey++}`}
          name={matched}
          referenceAttachments={refs}
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