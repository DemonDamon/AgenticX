"use client";

import { Badge } from "@agenticx/ui";
import type { TraceConversationMessage } from "../lib/trace-conversation-io";

export type ConversationMessageListLabels = {
  roleUser: string;
  roleAssistant: string;
  roleTool: string;
  roleSystem: string;
  reasoning: string;
  attachments: string;
  chars: string;
};

function roleLabel(role: string, labels: ConversationMessageListLabels): string {
  switch (role) {
    case "user":
      return labels.roleUser;
    case "assistant":
      return labels.roleAssistant;
    case "tool":
      return labels.roleTool;
    case "system":
      return labels.roleSystem;
    default:
      return role;
  }
}

export function ConversationMessageList({
  messages,
  labels,
  className,
}: {
  messages: TraceConversationMessage[];
  labels: ConversationMessageListLabels;
  className?: string;
}) {
  return (
    <div className={className ?? "max-h-[360px] space-y-2 overflow-auto"}>
      {messages.map((msg) => (
        <div key={msg.id} className="rounded-md border border-border bg-muted/30 p-2">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <Badge variant={msg.role === "user" ? "secondary" : "outline"} className="h-5 text-[10px]">
              {roleLabel(msg.role, labels)}
            </Badge>
            {msg.model ? (
              <span className="font-mono text-[10px] text-muted-foreground">{msg.model}</span>
            ) : null}
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {msg.content.length.toLocaleString()} {labels.chars}
              {msg.content.truncated ? " · …" : ""}
            </span>
          </div>
          {msg.attachments && msg.attachments.length > 0 ? (
            <div className="mb-1.5 flex flex-wrap gap-1">
              <span className="text-[10px] text-muted-foreground">{labels.attachments}:</span>
              {msg.attachments.map((att, idx) => (
                <Badge
                  key={`${att.name ?? idx}`}
                  variant="outline"
                  className="h-5 max-w-[160px] truncate text-[10px]"
                >
                  {att.name || att.mime || "file"}
                  {att.mime ? ` (${att.mime})` : ""}
                </Badge>
              ))}
            </div>
          ) : null}
          {msg.reasoning?.text ? (
            <div className="mb-1.5 rounded border border-dashed border-border/80 bg-background/60 p-1.5">
              <div className="mb-0.5 text-[10px] font-medium text-muted-foreground">
                {labels.reasoning}
                {msg.reasoning.truncated ? " · …" : ""}
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
                {msg.reasoning.text}
              </pre>
            </div>
          ) : null}
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">
            {msg.content.text || "—"}
          </pre>
        </div>
      ))}
    </div>
  );
}
