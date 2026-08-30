import { useCallback, useEffect, useRef, useState } from "react";
import { Users, X } from "lucide-react";
import {
  bubbleKind,
  firstScreenAfterSeq,
  membersChanged,
  statusLabel,
  upsertBySeq,
  visibleContent,
  type RoomMember,
  type RoomMessage,
  type RoomStreamStatus,
  type RoomSummary,
} from "../utils/collab-room-view";

const MEMBER_POLL_MS = 3000;

type Props = {
  open?: boolean;
  onClose?: () => void;
  variant?: "dialog" | "page";
};

const NOT_LOGGED_IN = "未登录企业账号，无法加载云房间";

function asRoom(raw: unknown): RoomSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== "string") return null;
  return {
    id: item.id,
    title: typeof item.title === "string" && item.title.trim() ? item.title : "未命名房间",
    member_count: typeof item.member_count === "number" ? item.member_count : 0,
    last_seq: typeof item.last_seq === "number" ? item.last_seq : 0,
  };
}

function asMember(raw: unknown): RoomMember | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== "string") return null;
  return {
    id: item.id,
    member_type: typeof item.member_type === "string" ? item.member_type : "human",
    member_id: typeof item.member_id === "string" ? item.member_id : "",
    display_name: typeof item.display_name === "string" ? item.display_name : "成员",
    room_role: typeof item.room_role === "string" ? item.room_role : "member",
  };
}

function asMessage(raw: unknown): RoomMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.seq !== "number") return null;
  return {
    id: item.id,
    room_id: typeof item.room_id === "string" ? item.room_id : "",
    seq: item.seq,
    sender_type: typeof item.sender_type === "string" ? item.sender_type : "human",
    sender_id: typeof item.sender_id === "string" ? item.sender_id : "",
    sender_name: typeof item.sender_name === "string" ? item.sender_name : "成员",
    content: typeof item.content === "string" ? item.content : "",
    created_at: typeof item.created_at === "string" ? item.created_at : undefined,
  };
}

export function CollabRoomPanel({ open = true, onClose, variant = "dialog" }: Props) {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [viewerUserId, setViewerUserId] = useState("");
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [status, setStatus] = useState<RoomStreamStatus>("connecting");
  const [roomError, setRoomError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const activeRoomIdRef = useRef<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  activeRoomIdRef.current = activeRoomId;

  const stopWatch = useCallback(async (roomId: string | null) => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    if (roomId) {
      try {
        await window.agenticxDesktop.collabRoomUnwatch(roomId);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const loadRooms = useCallback(async () => {
    setListBusy(true);
    setListError(null);
    try {
      const res = await window.agenticxDesktop.collabRoomList();
      if (!res.ok) {
        setRooms([]);
        setListError(res.error || "云房间服务暂时不可用");
        return;
      }
      setRooms((res.data?.rooms ?? []).map(asRoom).filter((item): item is RoomSummary => item != null));
    } catch {
      setRooms([]);
      setListError("云房间服务暂时不可用");
    } finally {
      setListBusy(false);
    }
  }, []);

  const openRoom = useCallback(
    async (roomId: string) => {
      const previous = activeRoomIdRef.current;
      if (previous && previous !== roomId) await stopWatch(previous);
      setActiveRoomId(roomId);
      setRoomError(null);
      setSendError(null);
      setMessages([]);
      setMembers([]);
      setViewerUserId("");
      setStatus("connecting");
      try {
        const detail = await window.agenticxDesktop.collabRoomGet(roomId);
        if (!detail.ok) {
          setRoomError(detail.error || "云房间服务暂时不可用");
          setStatus(detail.error === "你已被移出该房间" ? "revoked" : "error");
          return;
        }
        const nextRoom = asRoom(detail.data?.room);
        const nextMembers = (detail.data?.members ?? [])
          .map(asMember)
          .filter((item): item is RoomMember => item != null);
        const viewer = typeof detail.data?.viewer_user_id === "string" ? detail.data.viewer_user_id : "";
        setRoom(nextRoom);
        setMembers(nextMembers);
        setViewerUserId(viewer);
        const afterSeq = firstScreenAfterSeq(nextRoom?.last_seq ?? 0);
        const history = await window.agenticxDesktop.collabRoomMessages(roomId, {
          afterSeq,
          limit: 200,
        });
        if (!history.ok) {
          setRoomError(history.error || "云房间服务暂时不可用");
          setStatus("error");
          return;
        }
        const loaded = (history.data?.messages ?? [])
          .map(asMessage)
          .filter((item): item is RoomMessage => item != null);
        setMessages(loaded.reduce<RoomMessage[]>((acc, item) => upsertBySeq(acc, item), []));
        unsubscribeRef.current?.();
        unsubscribeRef.current = window.agenticxDesktop.onCollabRoomEvent((payload) => {
          if (payload.roomId !== activeRoomIdRef.current) return;
          if (payload.event.type === "room_message") {
            const incoming = asMessage(payload.event.message);
            if (incoming) setMessages((list) => upsertBySeq(list, incoming));
            setStatus("live");
            return;
          }
          if (payload.event.type === "room_closed" && payload.event.reason === "gone") {
            setStatus("revoked");
            setRooms((list) => list.filter((item) => item.id !== payload.roomId));
            return;
          }
          if (payload.event.type === "room_closed" && payload.event.reason === "retry") {
            setStatus("retrying");
            return;
          }
          if (payload.event.type === "room_ping" || payload.event.type === "room_cursor") {
            setStatus("live");
          }
        });
        const watch = await window.agenticxDesktop.collabRoomWatch(roomId);
        if (!watch.ok) {
          setRoomError(watch.error || "云房间服务暂时不可用");
          setStatus("error");
          return;
        }
        setStatus("live");
      } catch {
        setRoomError("云房间服务暂时不可用");
        setStatus("error");
      }
    },
    [stopWatch],
  );

  const refreshSnapshot = useCallback(async (roomId: string) => {
    try {
      const detail = await window.agenticxDesktop.collabRoomGet(roomId);
      if (activeRoomIdRef.current !== roomId) return;
      if (!detail.ok) {
        if (detail.error === "你已被移出该房间") setStatus("revoked");
        return;
      }
      const nextRoom = asRoom(detail.data?.room);
      const nextMembers = (detail.data?.members ?? [])
        .map(asMember)
        .filter((item): item is RoomMember => item != null);
      const viewer = typeof detail.data?.viewer_user_id === "string" ? detail.data.viewer_user_id : "";
      setRoom(nextRoom);
      setMembers((prev) => (membersChanged(prev, nextMembers) ? nextMembers : prev));
      if (viewer) setViewerUserId(viewer);
      const count = nextRoom?.member_count ?? nextMembers.length;
      setRooms((list) =>
        list.map((item) => (item.id === roomId ? { ...item, member_count: count } : item)),
      );
    } catch {
      /* keep the last snapshot; the watch loop already surfaces hard failures */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadRooms();
  }, [open, loadRooms]);

  useEffect(() => {
    if (!open || !activeRoomId) return;
    if (status !== "live" && status !== "retrying") return;
    const roomId = activeRoomId;
    void refreshSnapshot(roomId);
    const timer = window.setInterval(() => {
      void refreshSnapshot(roomId);
    }, MEMBER_POLL_MS);
    return () => window.clearInterval(timer);
  }, [open, activeRoomId, status, refreshSnapshot]);

  useEffect(() => {
    if (!open || variant === "page" || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, variant]);

  useEffect(() => {
    if (open) return;
    const roomId = activeRoomIdRef.current;
    void stopWatch(roomId);
    setActiveRoomId(null);
    setRoom(null);
    setMessages([]);
    setDraft("");
    setSendError(null);
    setRoomError(null);
  }, [open, stopWatch]);

  useEffect(() => {
    return () => {
      unsubscribeRef.current?.();
      const roomId = activeRoomIdRef.current;
      if (roomId) {
        void window.agenticxDesktop.collabRoomUnwatch(roomId);
      }
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, activeRoomId]);

  const onSend = async () => {
    const roomId = activeRoomId;
    const text = draft.trim();
    if (!roomId || !text || sending || status === "revoked") return;
    const tempId = `temp-${Date.now()}`;
    const optimistic: RoomMessage = {
      id: tempId,
      room_id: roomId,
      seq: Number.MAX_SAFE_INTEGER,
      sender_type: "human",
      sender_id: viewerUserId,
      sender_name: "我",
      content: text,
    };
    setSending(true);
    setSendError(null);
    setDraft("");
    setMessages((list) => upsertBySeq(list, optimistic));
    try {
      const res = await window.agenticxDesktop.collabRoomSend(roomId, text);
      if (!res.ok) {
        setMessages((list) => list.filter((item) => item.id !== tempId));
        setDraft(text);
        setSendError(res.error || "云房间服务暂时不可用");
        return;
      }
      const server = asMessage(res.data?.message);
      setMessages((list) => {
        const withoutTemp = list.filter((item) => item.id !== tempId);
        return server ? upsertBySeq(withoutTemp, server) : withoutTemp;
      });
    } catch {
      setMessages((list) => list.filter((item) => item.id !== tempId));
      setDraft(text);
      setSendError("云房间服务暂时不可用");
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  const notLoggedIn = listError === NOT_LOGGED_IN;
  const memberNames = members.map((item) => item.display_name).filter(Boolean);
  const revoked = status === "revoked";
  const isPage = variant === "page";
  const title = isPage ? "多人协作" : "云房间";

  const header = (
    <div
      className={
        isPage
          ? "flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-5"
          : "flex items-center justify-between border-b border-border bg-surface-base px-5 py-4"
      }
    >
      <div className={isPage ? "min-w-0" : "flex items-center gap-2"}>
        {isPage ? (
          <>
            <h2 id="agx-collab-rooms-title" className="text-lg font-semibold tracking-tight text-text-strong">
              {title}
            </h2>
            <p className="mt-1 text-sm text-text-muted">与同事在同一间云房间里实时对话。</p>
          </>
        ) : (
          <>
            <Users className="h-4 w-4 text-text-faint" strokeWidth={1.8} />
            <h2 id="agx-collab-rooms-title" className="text-lg font-semibold tracking-tight text-text-strong">
              {title}
            </h2>
          </>
        )}
      </div>
      {!isPage && onClose ? (
        <button
          type="button"
          className="agx-topbar-btn !h-10 !w-10"
          onClick={onClose}
          aria-label="关闭"
          title="关闭"
        >
          <X className="h-5 w-5" />
        </button>
      ) : null}
    </div>
  );

  const body = (
        <div className="flex min-h-0 min-w-0 flex-1">
          <aside className="flex w-[240px] shrink-0 flex-col border-r border-border bg-surface-base">
            <div className="border-b border-border px-3 py-2 text-xs text-text-faint">房间列表</div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {listBusy ? <p className="px-2 py-3 text-sm text-text-faint">加载中…</p> : null}
              {listError ? (
                <div className="space-y-2 px-2 py-3">
                  <p className="text-sm text-text-primary">{listError}</p>
                  {notLoggedIn ? (
                    <p className="text-xs text-text-faint">请先在设置里完成企业登录</p>
                  ) : (
                    <button
                      type="button"
                      className="rounded-md border border-border bg-surface-card px-2 py-1 text-xs text-text-strong"
                      onClick={() => void loadRooms()}
                    >
                      重试
                    </button>
                  )}
                </div>
              ) : null}
              {!listBusy && !listError && rooms.length === 0 ? (
                <p className="px-2 py-3 text-sm leading-relaxed text-text-faint">
                  还没有云房间。请在企业门户里创建或让同事把你加进来。
                </p>
              ) : null}
              {rooms.map((item) => {
                const active = item.id === activeRoomId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`mb-1 w-full rounded-md px-2.5 py-2 text-left ${
                      active
                        ? "bg-surface-card-strong text-text-strong"
                        : "text-text-primary hover:bg-surface-card"
                    }`}
                    onClick={() => void openRoom(item.id)}
                  >
                    <div className="truncate text-sm font-medium">{item.title}</div>
                    <div className="mt-0.5 text-[11px] text-text-faint">{item.member_count} 名成员</div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-base">
            {!activeRoomId ? (
              <div className="flex flex-1 items-center justify-center px-6 text-sm text-text-faint">
                选择左侧房间开始对话
              </div>
            ) : revoked ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-base font-medium text-text-strong">{statusLabel("revoked")}</p>
                <button
                  type="button"
                  className="rounded-md border border-border bg-surface-card px-3 py-1.5 text-sm text-text-strong"
                  onClick={() => {
                    void stopWatch(activeRoomId);
                    setActiveRoomId(null);
                    setRoom(null);
                    setMessages([]);
                    setStatus("connecting");
                  }}
                >
                  返回房间列表
                </button>
              </div>
            ) : (
              <>
                <div className="shrink-0 border-b border-border px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="truncate text-sm font-semibold text-text-strong">{room?.title ?? "协作房间"}</h3>
                    <span className="shrink-0 text-[11px] text-text-faint">{statusLabel(status)}</span>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-text-faint">
                    {members.length} 名成员
                    {memberNames.length ? ` · ${memberNames.join("、")}` : ""}
                  </p>
                </div>
                {roomError ? <p className="px-4 py-2 text-sm text-text-primary">{roomError}</p> : null}
                <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
                  {messages.map((message) => {
                    const kind = bubbleKind(message, viewerUserId);
                    if (kind === "system") {
                      return (
                        <div key={message.id} className="text-center text-xs text-text-faint whitespace-pre-wrap">
                          {visibleContent(message.content)}
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
                              ? "bg-[var(--chat-im-user-bg)] text-text-strong"
                              : kind === "meta"
                                ? "border border-border bg-surface-card text-text-primary"
                                : "bg-surface-card text-text-primary",
                          ].join(" ")}
                        >
                          <div className="mb-1 text-[11px] text-text-faint">
                            {kind === "meta" ? "Meta" : mine ? "我" : message.sender_name || "成员"}
                          </div>
                          <div className="whitespace-pre-wrap break-words">{visibleContent(message.content)}</div>
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
                  <input
                    className="min-w-0 flex-1 rounded-md border border-border bg-surface-card px-3 py-2 text-sm text-text-primary outline-none"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={sending ? "发送中…" : "输入消息，Enter 发送"}
                    disabled={sending}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void onSend();
                      }
                    }}
                  />
                  <button
                    type="submit"
                    className="shrink-0 rounded-md border border-border bg-surface-card-strong px-3 py-2 text-sm text-text-strong disabled:opacity-50"
                    disabled={sending || !draft.trim()}
                  >
                    发送
                  </button>
                </form>
                {sendError ? <p className="px-3 pb-3 text-xs text-text-primary">{sendError}</p> : null}
              </>
            )}
          </section>
        </div>
  );

  if (isPage) {
    return (
      <div
        className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface-base"
        aria-labelledby="agx-collab-rooms-title"
      >
        {header}
        {body}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/88 px-3 py-6 backdrop-blur-md">
      <div
        className="relative flex h-[min(85vh,720px)] w-full max-w-[960px] flex-col overflow-hidden rounded-xl border border-border bg-surface-base shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agx-collab-rooms-title"
      >
        {header}
        {body}
      </div>
    </div>
  );
}
