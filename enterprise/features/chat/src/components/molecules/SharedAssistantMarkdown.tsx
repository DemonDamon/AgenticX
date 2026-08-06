"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { WebSearchSource } from "@agenticx/core-api";
import { createAssistantMdComponents } from "../../markdown/assistant-markdown-components";
import "../../markdown/chat-prism-themes.css";

export function SharedAssistantMarkdown({
  text,
  sources,
  onOpenExternalUrl,
}: {
  text: string;
  sources?: WebSearchSource[];
  onOpenExternalUrl?: (url: string, title?: string) => void;
}) {
  const components = React.useMemo(
    () => createAssistantMdComponents({ sources, onOpenExternalUrl }),
    [sources, onOpenExternalUrl],
  );

  return (
    <div className="agx-assistant-md break-words text-[15px] leading-7">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
