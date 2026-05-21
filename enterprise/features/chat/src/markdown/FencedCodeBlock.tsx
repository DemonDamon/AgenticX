import * as React from "react";
import { highlightChatCode } from "./highlight-chat-code";

type FencedCodeBlockProps = {
  text: string;
  lang: string | null;
};

function languageLabel(lang: string | null): string {
  if (!lang) return "text";
  return lang;
}

export function FencedCodeBlock({ text, lang }: FencedCodeBlockProps) {
  const [copied, setCopied] = React.useState(false);
  const html = React.useMemo(() => highlightChatCode(text, lang), [text, lang]);
  const codeClass = lang ? `language-${lang}` : undefined;

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore clipboard failures
    }
  }, [text]);

  return (
    <div className="my-2.5 overflow-hidden rounded-lg border border-border/70 bg-muted/20 last:mb-0">
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/45 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          {languageLabel(lang)}
        </span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="rounded px-2 py-0.5 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="agx-chat-prism m-0 overflow-x-auto p-3">
        <code className={codeClass} dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}
