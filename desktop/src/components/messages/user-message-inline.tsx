import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { Sparkles } from "lucide-react";
import type { Components } from "react-markdown";
import type { MessageAttachment } from "../../store";
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
    <span
      className="agx-composer-inline-chip mx-0.5 inline-flex max-w-[min(100%,280px)] items-center gap-0.5 rounded-md px-2 py-0.5 align-middle text-[12px] font-medium leading-snug"
      title={`@skill://${name}`}
    >
      <Sparkles className="h-3 w-3 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
      <span className="min-w-0 truncate">{name}</span>
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
  const names = Array.from(
    new Set(
      referenceAttachments
        .map((att) => String(att.name || "").trim())
        .filter((name) => name.length > 0)
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
        <span
          key={`ref-${chipKey++}`}
          className="agx-composer-inline-chip mx-0.5 inline-flex items-center rounded-md px-1.5 py-0.5 align-middle text-[12px] font-medium leading-[1.2]"
        >
          {matched}
        </span>
      );
      cursor += matched.length + 1;
      continue;
    }

    pushMarkdown(bodyText.slice(cursor, cursor + 1));
    cursor += 1;
  }

  return chunks.length > 0 ? <>{chunks}</> : null;
}