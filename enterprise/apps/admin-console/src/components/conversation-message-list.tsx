"use client";

import { useState, type ReactNode } from "react";
import { Badge, Button } from "@agenticx/ui";
import type { TraceConversationMessage } from "../lib/trace-conversation-io";
import { ConversationMarkdown } from "./conversation-md";

/** Default visible length for collapsed assistant reasoning + body previews. */
export const MESSAGE_PREVIEW_CHARS = 100;
/** @deprecated alias — same as MESSAGE_PREVIEW_CHARS */
export const REASONING_PREVIEW_CHARS = MESSAGE_PREVIEW_CHARS;

export type ConversationMessageListLabels = {
  roleUser: string;
  roleAssistant: string;
  roleTool: string;
  roleSystem: string;
  reasoning: string;
  attachments: string;
  chars: string;
  /** Single toggle for assistant reasoning + body (展开 / 收起). */
  expand: string;
  collapse: string;
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

function previewText(raw: string, open: boolean): string {
  if (open || raw.length <= MESSAGE_PREVIEW_CHARS) return raw;
  return `${raw.slice(0, MESSAGE_PREVIEW_CHARS)}…`;
}

function MessageChrome({
  roleBadge,
  model,
  charsLabel,
  action,
  attachments,
  children,
}: {
  roleBadge: ReactNode;
  model?: string;
  charsLabel: ReactNode;
  action?: ReactNode;
  attachments?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2">
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        {roleBadge}
        {model ? (
          <span className="font-mono text-[10px] text-muted-foreground">{model}</span>
        ) : null}
        {action}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{charsLabel}</span>
      </div>
      {attachments}
      {children}
    </div>
  );
}

function AttachmentsRow({
  msg,
  labels,
}: {
  msg: TraceConversationMessage;
  labels: ConversationMessageListLabels;
}) {
  if (!msg.attachments || msg.attachments.length === 0) return null;
  return (
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
  );
}

function AssistantMessageCard({
  msg,
  labels,
}: {
  msg: TraceConversationMessage;
  labels: ConversationMessageListLabels;
}) {
  const [open, setOpen] = useState(false);
  const reasoningRaw = msg.reasoning?.text ?? "";
  const bodyRaw = msg.content.text ?? "";
  const needsCollapse =
    reasoningRaw.length > MESSAGE_PREVIEW_CHARS || bodyRaw.length > MESSAGE_PREVIEW_CHARS;

  return (
    <MessageChrome
      roleBadge={
        <Badge variant="outline" className="h-5 text-[10px]">
          {labels.roleAssistant}
        </Badge>
      }
      model={msg.model}
      action={
        needsCollapse ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px]"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? labels.collapse : labels.expand}
          </Button>
        ) : null
      }
      charsLabel={
        <>
          {msg.content.length.toLocaleString()} {labels.chars}
          {msg.content.truncated ? " · …" : ""}
        </>
      }
      attachments={<AttachmentsRow msg={msg} labels={labels} />}
    >
      <div className="space-y-1.5">
        {reasoningRaw ? (
          <div className="rounded border border-dashed border-border/80 bg-background/60 p-1.5">
            <div className="mb-1 text-[10px] font-medium text-muted-foreground">
              {labels.reasoning}
              {msg.reasoning?.truncated ? " · …" : ""}
            </div>
            <ConversationMarkdown
              text={previewText(reasoningRaw, open)}
              className="text-[12px] leading-relaxed break-words text-muted-foreground"
            />
          </div>
        ) : null}
        <ConversationMarkdown text={previewText(bodyRaw, open)} />
      </div>
    </MessageChrome>
  );
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
      {messages.map((msg) =>
        msg.role === "assistant" ? (
          <AssistantMessageCard key={msg.id} msg={msg} labels={labels} />
        ) : (
          <MessageChrome
            key={msg.id}
            roleBadge={
              <Badge variant="secondary" className="h-5 text-[10px]">
                {roleLabel(msg.role, labels)}
              </Badge>
            }
            model={msg.model}
            charsLabel={
              <>
                {msg.content.length.toLocaleString()} {labels.chars}
                {msg.content.truncated ? " · …" : ""}
              </>
            }
            attachments={<AttachmentsRow msg={msg} labels={labels} />}
          >
            <ConversationMarkdown text={msg.content.text || ""} />
          </MessageChrome>
        ),
      )}
    </div>
  );
}
