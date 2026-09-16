"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
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

type LoadErrorKey = "" | "revoked" | "openFailed";

export function RoomChatView({ roomId, currentUserId }: RoomChatViewProps) {
  const t = useTranslations("rooms");
  const { messages, status, send } = useRoomStream(roomId);
  const [room, setRoom] = useState<CollabRoom | null>(null);
  const [members, setMembers] = useState<CollabRoomMember[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [loadError, setLoadError] = useState<LoadErrorKey>("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadRoom = useCallback(async () => {
    const res = await fetch(`/api/rooms/${roomId}`, { cache: "no-store" });
    const body = (await res.json()) as Envelope<{ room: CollabRoom; members: CollabRoomMember[] }>;
    if (res.status === 403) {
      setLoadError("revoked");
      return;
    }
    if (!res.ok) {
      setLoadError("openFailed");
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

  const revoked = status === "revoked" || loadError === "revoked";

  const onSend = async () => {
    const text = draft;
    if (!text.trim() || sending || revoked) return;
    setSending(true);
    setSendError("");
    try {
      await send(text);
      setDraft("");
    } catch {
      setSendError(t("sendFailed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <Link href="/rooms" className="text-sm text-muted-foreground hover:text-foreground">
            {t("backToList")}
          </Link>
          <h1 className="truncate text-lg font-semibold">{room?.title ?? t("title")}</h1>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {status === "live"
            ? t("statusLive")
            : status === "polling"
              ? t("statusPolling")
              : status === "connecting"
                ? t("statusConnecting")
                : null}
        </span>
      </header>

      {revoked ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-base font-medium">{t("revoked")}</p>
          <Link href="/rooms">
            <Button>{t("backToList")}</Button>
          </Link>
        </div>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1">
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {loadError && loadError !== "revoked" ? (
              <p className="px-4 py-2 text-sm text-destructive">{t(loadError)}</p>
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
                        {kind === "meta" ? "Meta" : mine ? t("me") : message.sender_name || t("member")}
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
                placeholder={sending ? t("sending") : t("inputPlaceholder")}
                disabled={sending}
              />
              <Button type="submit" disabled={sending || !draft.trim()}>
                {t("send")}
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
