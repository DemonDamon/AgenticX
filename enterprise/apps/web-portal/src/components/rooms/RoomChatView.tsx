"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Input } from "@agenticx/ui";
import type { CollabRoom, CollabRoomMember, CollabRoomMessage } from "../../lib/collab-room/types";
import { RoomMembersPanel } from "./RoomMembersPanel";
import { useRoomStream } from "./useRoomStream";

type RoomChatViewProps = {
  roomId: string;
  currentUserId: string;
};

type Envelope<T> = { data?: T; error?: { message?: string } };

function bubbleAlign(message: CollabRoomMessage, currentUserId: string): "self" | "other" | "meta" | "system" {
  if (message.sender_type === "system") return "system";
  if (message.sender_type === "meta") return "meta";
  if (message.sender_id === currentUserId || message.sender_id === "self") return "self";
  return "other";
}

function visibleMessageContent(content: string): string {
  const stripped = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  return stripped || content.trim();
}

export function RoomChatView({ roomId, currentUserId }: RoomChatViewProps) {
  const { messages, status, send } = useRoomStream(roomId);
  const [room, setRoom] = useState<CollabRoom | null>(null);
  const [members, setMembers] = useState<CollabRoomMember[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [loadError, setLoadError] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadRoom = useCallback(async () => {
    const res = await fetch(`/api/rooms/${roomId}`, { cache: "no-store" });
    const body = (await res.json()) as Envelope<{ room: CollabRoom; members: CollabRoomMember[] }>;
    if (res.status === 403) {
      setLoadError("你已被移出该房间");
      return;
    }
    if (!res.ok) {
      setLoadError("无法打开房间");
      return;
    }
    setLoadError("");
    setRoom(body.data?.room ?? null);
    setMembers(body.data?.members ?? []);
  }, [roomId]);

  useEffect(() => {
    void loadRoom();
  }, [loadRoom]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const revoked = status === "revoked" || loadError === "你已被移出该房间";

  const onSend = async () => {
    const text = draft;
    if (!text.trim() || sending || revoked) return;
    setSending(true);
    setSendError("");
    try {
      await send(text);
      setDraft("");
    } catch {
      setSendError("发送失败，内容仍保留在输入框，请重试");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <Link href="/rooms" className="text-sm text-muted-foreground hover:text-foreground">
            返回房间列表
          </Link>
          <h1 className="truncate text-lg font-semibold">{room?.title ?? "协作房间"}</h1>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {status === "live" ? "实时" : status === "polling" ? "轮询同步" : status === "connecting" ? "连接中" : null}
        </span>
      </header>

      {revoked ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-base font-medium">你已被移出该房间</p>
          <Link href="/rooms">
            <Button>返回房间列表</Button>
          </Link>
        </div>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1">
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {loadError && loadError !== "你已被移出该房间" ? (
              <p className="px-4 py-2 text-sm text-destructive">{loadError}</p>
            ) : null}
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages.map((message) => {
                const kind = bubbleAlign(message, currentUserId);
                if (kind === "system") {
                  return (
                    <div key={message.id} className="text-center text-xs text-muted-foreground whitespace-pre-wrap">
                      {message.content}
                    </div>
                  );
                }
                const mine = kind === "self";
                return (
                  <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={[
                        "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                        mine
                          ? "bg-primary text-primary-foreground"
                          : kind === "meta"
                            ? "border border-border bg-muted"
                            : "bg-card text-card-foreground shadow-sm",
                      ].join(" ")}
                    >
                      <div className="mb-1 text-[11px] opacity-80">
                        {kind === "meta" ? "Meta" : mine ? "我" : message.sender_name || "成员"}
                      </div>
                      <div className="whitespace-pre-wrap break-words">{visibleMessageContent(message.content)}</div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
            <form
              className="flex items-end gap-2 border-t border-border p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void onSend();
              }}
            >
              <Input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={sending ? "发送中…" : "输入消息，@Meta 可点名助手"}
                disabled={sending}
              />
              <Button type="submit" disabled={sending || !draft.trim()}>
                发送
              </Button>
            </form>
            {sendError ? <p className="px-3 pb-3 text-xs text-destructive">{sendError}</p> : null}
          </section>
          <RoomMembersPanel
            roomId={roomId}
            currentUserId={currentUserId}
            members={members}
            onChanged={() => void loadRoom()}
          />
        </div>
      )}
    </div>
  );
}
