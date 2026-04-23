"use client";

import * as React from "react";
import { InputArea, MessageList, ModelSelector, useChatStore } from "@agenticx/feature-chat";
import { type ChatClient } from "@agenticx/sdk-ts";
import { Cpu, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle, Badge, MachiAvatar } from "@agenticx/ui";
import { usePortalCopy } from "../lib/portal-copy";

const MODELS = ["deepseek-chat", "moonshot-v1-8k", "gpt-4o-mini"];

type MachiChatViewProps = {
  client: ChatClient;
};

function inferRoute(model: string): string {
  if (model.includes("local")) return "local";
  if (model.includes("moonshot")) return "private-cloud";
  return "third-party";
}

export function MachiChatView({ client }: MachiChatViewProps) {
  const t = usePortalCopy();
  const {
    activeSessionId,
    messages,
    status,
    activeModel,
    errorMessage,
    bootstrap,
    switchModel,
    sendMessage,
    cancel,
  } = useChatStore();
  const [draft, setDraft] = React.useState("");

  React.useEffect(() => {
    if (!activeSessionId) {
      bootstrap({ defaultModel: MODELS[0] });
    }
  }, [activeSessionId, bootstrap]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <MachiAvatar size={28} className="h-7 w-7" />
          <span className="text-sm font-medium">Machi Workspace</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <Cpu className="h-3.5 w-3.5" />
            {t.routeLabel}: {inferRoute(activeModel)}
          </Badge>
          <ModelSelector value={activeModel} options={MODELS} onChange={switchModel} />
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <MachiAvatar size={280} className="h-[220px] w-[220px] opacity-10" />
        </div>
        <div className="relative h-full px-4 py-3">
          <MessageList messages={messages} />
        </div>
      </div>

      <div className="border-t border-zinc-800 bg-[#1a1a1a] p-4">
        {errorMessage && (
          <Alert variant="warning" className="mb-3 border-amber-700/60 bg-amber-950/20">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>{t.complianceTitle}</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
        <InputArea
          value={draft}
          status={status}
          onChange={setDraft}
          onSend={() => {
            void sendMessage(client, { content: draft });
            setDraft("");
          }}
          onCancel={() => void cancel(client)}
        />
      </div>
    </div>
  );
}

