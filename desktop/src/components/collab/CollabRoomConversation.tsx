import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { CommandMenu } from "../composer/CommandMenu";
import { CommandPerfCard } from "../composer/CommandPerfCard";
import { fetchSessionPerf, fetchVisibleCommands, perfCardError, type VisibleCommand } from "../../services/commandsApi";
import { buildPerfDiagnosisText, composeRoomCommandSend, parsePerfCommandInput } from "../../utils/command-send";
import { matchSlashCommandQuery } from "../../utils/composer-input-sync";
import { i18n } from "../../i18n/i18n";
import {
  bubbleKind,
  firstScreenAfterSeq,
  membersChanged,
  upsertBySeq,
  visibleContent,
  type RoomMember,
  type RoomMessage,
  type RoomStreamStatus,
  type RoomSummary,
} from "../../utils/collab-room-view";

const MEMBER_POLL_MS = 3000;

type Props = {
  roomId: string;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (messageId: string) => void;
  renderMessageExtra?: (message: RoomMessage) => ReactNode;
  headerTrailing?: ReactNode;
  textQuery?: string;
  reloadToken?: number;
  selectionBar?: ReactNode;
  showStatus?: boolean;
  onStreamStatus?: (status: RoomStreamStatus) => void;
  onRevoked?: () => void;
  onMemberCount?: (count: number) => void;
  onBack?: () => void;
  onViewSource?: (roomId: string) => void;
  onFromCache?: (fromCache: boolean) => void;
};

function asRoom(raw: unknown): RoomSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== "string") return null;
  return {
    id: item.id,
    title: typeof item.title === "string" && item.title.trim() ? item.title : i18n.t("collab.unnamedRoom", { ns: "workspace" }),
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
    display_name: typeof item.display_name === "string" ? item.display_name : i18n.t("collab.member", { ns: "workspace" }),
    room_role: typeof item.room_role === "string" ? item.room_role : "member",
  };
}

function asMessage(raw: unknown): RoomMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.seq !== "number") return null;
  const metadata =
    item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
      ? (item.metadata as Record<string, unknown>)
      : null;
  return {
    id: item.id,
    room_id: typeof item.room_id === "string" ? item.room_id : "",
    seq: item.seq,
    sender_type: typeof item.sender_type === "string" ? item.sender_type : "human",
    sender_id: typeof item.sender_id === "string" ? item.sender_id : "",
    sender_name: typeof item.sender_name === "string" ? item.sender_name : i18n.t("collab.member", { ns: "workspace" }),
    content: typeof item.content === "string" ? item.content : "",
    created_at: typeof item.created_at === "string" ? item.created_at : undefined,
    metadata,
    client_msg_id: typeof item.client_msg_id === "string" ? item.client_msg_id : null,
  };
}

type LocalSendStatus = "pending" | "failed";
type ConversationMessage = RoomMessage & { status?: LocalSendStatus };

function placeMessage(list: ConversationMessage[], incoming: ConversationMessage): ConversationMessage[] {
  return upsertBySeq(list, incoming) as ConversationMessage[];
}

function withServerMessage(list: ConversationMessage[], incoming: RoomMessage): ConversationMessage[] {
  const clientId = incoming.client_msg_id;
  const stripped = clientId
    ? list.filter((item) => item.client_msg_id !== clientId && item.id !== clientId)
    : list;
  return upsertBySeq(stripped, incoming) as ConversationMessage[];
}

function DeliveryMark({
  message,
  onRetry,
}: {
  message: ConversationMessage;
  onRetry: (message: ConversationMessage) => void;
}) {
  const { t } = useTranslation("workspace");
  const status = message.status;
  if (!status) return null;
  switch (status) {
    case "pending":
      return (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-text-faint">
          <span
            className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"
            aria-hidden
          />
          {t("collab.pendingSend")}
        </div>
      );
    case "failed":
      return (
        <div className="mt-1 flex items-center gap-2 text-[11px] text-text-faint">
          <span>{t("collab.sendFailed")}</span>
          <button type="button" className="text-text-muted hover:text-text-strong" onClick={() => onRetry(message)}>
            {t("collab.retry")}
          </button>
        </div>
      );
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function previewLines(content: string): string[] {
  const raw = content.split("\n");
  const body = raw[0]?.startsWith("【") ? raw.slice(1) : raw;
  return body.map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
}

function modeTagKey(mode: string): "merge.mode.all" | "merge.tagSelected" | "merge.mode.summary" | "" {
  switch (mode) {
    case "all":
      return "merge.mode.all";
    case "selected":
      return "merge.tagSelected";
    case "summary":
      return "merge.mode.summary";
    default:
      return "";
  }
}

function MergeBackCard({
  message,
  onViewSource,
}: {
  message: RoomMessage;
  onViewSource?: (roomId: string) => void;
}) {
  const { t } = useTranslation("projects");
  const [expanded, setExpanded] = useState(false);
  const meta = message.metadata ?? {};
  const sourceTitle = typeof meta.source_title === "string" ? meta.source_title : "";
  const sourceRoomId = typeof meta.source_room_id === "string" ? meta.source_room_id : "";
  const mode = typeof meta.mode === "string" ? meta.mode : "";
  const participants = Array.isArray(meta.participants)
    ? meta.participants.filter((item): item is string => typeof item === "string")
    : [];
  const count = typeof meta.count === "number" ? meta.count : 0;
  const summary = mode === "summary";
  const lines = previewLines(message.content);
  const tagKey = modeTagKey(mode);
  const tag = tagKey ? t(tagKey) : "";
  const stats = [participants.join("、"), count > 0 ? t("merge.count", { count }) : ""].filter(Boolean).join(" · ");
  return (
    <div className="max-w-[80%] rounded-md border border-border bg-surface-panel/70 px-2 py-1 text-xs text-text-faint">
      <div className="mb-1 break-words text-text-primary">{t("merge.cardTitle", { name: sourceTitle })}</div>
      <div className="mb-1 flex flex-wrap items-center gap-1">
        {tag ? <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[11px] text-text-muted">{tag}</span> : null}
        {stats ? <span>{stats}</span> : null}
      </div>
      {summary || expanded ? (
        <div className="whitespace-pre-wrap break-words text-text-primary">{message.content}</div>
      ) : (
        <div className="space-y-1">
          {lines.slice(0, 3).map((line, index) => (
            <div key={`${message.id}-${index}`} className="line-clamp-2 break-words text-text-primary">
              {line}
            </div>
          ))}
        </div>
      )}
      {!summary && !expanded && lines.length > 3 ? (
        <button
          type="button"
          className="mt-1 text-[11px] text-text-muted hover:text-text-strong"
          onClick={() => setExpanded(true)}
        >
          {t("merge.expand")}
        </button>
      ) : null}
      {sourceRoomId ? (
        <button
          type="button"
          className="mt-1 block text-[11px] text-text-muted hover:text-text-strong"
          onClick={() => onViewSource?.(sourceRoomId)}
        >
          {t("merge.viewSource")}
        </button>
      ) : null}
    </div>
  );
}

export function CollabRoomConversation({
  roomId,
  selectable = false,
  selectedIds,
  onToggleSelect,
  renderMessageExtra,
  headerTrailing,
  textQuery = "",
  reloadToken = 0,
  selectionBar,
  showStatus = true,
  onStreamStatus,
  onRevoked,
  onMemberCount,
  onBack,
  onViewSource,
  onFromCache,
}: Props) {
  const { t } = useTranslation("workspace");
  const { t: tChat } = useTranslation("chat");
  const { t: tProjects } = useTranslation("projects");
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);
  const setActiveCollabRoomId = useAppStore((s) => s.setActiveCollabRoomId);
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [viewerUserId, setViewerUserId] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [status, setStatus] = useState<RoomStreamStatus>("connecting");
  const [roomError, setRoomError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [roomCommand, setRoomCommand] = useState<VisibleCommand | null>(null);
  const [commandItems, setCommandItems] = useState<VisibleCommand[]>([]);
  const [perfCard, setPerfCard] = useState<{ error: string } | null>(null);
  const sendChainRef = useRef<Promise<void>>(Promise.resolve());
  const [sendError, setSendError] = useState<string | null>(null);
  const [approvedSeqs, setApprovedSeqs] = useState<Set<number>>(new Set());
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const activeRoomIdRef = useRef(roomId);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const onRevokedRef = useRef(onRevoked);
  const onMemberCountRef = useRef(onMemberCount);
  const onStreamStatusRef = useRef(onStreamStatus);
  const onFromCacheRef = useRef(onFromCache);
  onRevokedRef.current = onRevoked;
  onMemberCountRef.current = onMemberCount;
  onStreamStatusRef.current = onStreamStatus;
  onFromCacheRef.current = onFromCache;
  activeRoomIdRef.current = roomId;

  useEffect(() => {
    setActiveCollabRoomId(roomId);
    return () => setActiveCollabRoomId(null);
  }, [roomId, setActiveCollabRoomId]);

  useEffect(() => {
    onStreamStatusRef.current?.(status);
  }, [status]);

  const slashQuery = roomCommand ? null : matchSlashCommandQuery(draft);
  const slashOpen = slashQuery !== null;

  useEffect(() => {
    if (!slashOpen || !apiBase || !roomId) return;
    let cancelled = false;
    void fetchVisibleCommands(apiBase, apiToken, { context: "room", subjectId: roomId })
      .then((items) => {
        if (!cancelled) setCommandItems(items);
      })
      .catch(() => {
        if (!cancelled) setCommandItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [slashOpen, apiBase, apiToken, roomId]);

  const stopWatch = useCallback(async (id: string | null) => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    if (id) {
      try {
        await window.agenticxDesktop.collabRoomUnwatch(id);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const refreshSnapshot = useCallback(async (id: string) => {
    try {
      const detail = await window.agenticxDesktop.collabRoomGet(id);
      if (activeRoomIdRef.current !== id) return;
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
      onMemberCountRef.current?.(count);
    } catch {
      /* keep the last snapshot; the watch loop already surfaces hard failures */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setRoomError(null);
      setSendError(null);
      setMessages([]);
      setMembers([]);
      setViewerUserId("");
      setApprovedSeqs(new Set());
      setStatus("connecting");
      try {
        const detail = await window.agenticxDesktop.collabRoomGet(roomId);
        if (cancelled || activeRoomIdRef.current !== roomId) return;
        if (!detail.ok) {
          setRoomError(detail.error || i18n.t("collab.unavailable", { ns: "workspace" }));
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
        onMemberCountRef.current?.(nextRoom?.member_count ?? nextMembers.length);
        const afterSeq = firstScreenAfterSeq(nextRoom?.last_seq ?? 0);
        const history = await window.agenticxDesktop.collabRoomMessages(roomId, {
          afterSeq,
          limit: 200,
        });
        if (cancelled || activeRoomIdRef.current !== roomId) return;
        if (!history.ok) {
          setRoomError(history.error || i18n.t("collab.unavailable", { ns: "workspace" }));
          setStatus("error");
          return;
        }
        const loaded = (history.data?.messages ?? [])
          .map(asMessage)
          .filter((item): item is RoomMessage => item != null);
        let pending: ConversationMessage[] = [];
        const listPending = window.agenticxDesktop.collabOutboxList;
        if (listPending) {
          try {
            const queued = await listPending(roomId);
            if (!cancelled && activeRoomIdRef.current === roomId && queued.ok) {
              const known = new Set(loaded.flatMap((item) => (item.client_msg_id ? [item.client_msg_id] : [])));
              pending = (queued.data?.items ?? [])
                .filter((item) => !known.has(item.client_msg_id))
                .sort((a, b) => a.created_at - b.created_at)
                .map((item) => ({
                  id: item.client_msg_id,
                  room_id: item.room_id,
                  seq: Number.MAX_SAFE_INTEGER,
                  sender_type: "human",
                  sender_id: viewer,
                  sender_name: i18n.t("collab.me", { ns: "workspace" }),
                  content: item.content,
                  client_msg_id: item.client_msg_id,
                  status: "pending" as const,
                }));
            }
          } catch {
            /* ignore */
          }
        }
        if (cancelled || activeRoomIdRef.current !== roomId) return;
        const base = loaded.reduce<ConversationMessage[]>((acc, item) => placeMessage(acc, item), []);
        setMessages(pending.reduce((acc, item) => placeMessage(acc, item), base));
        onFromCacheRef.current?.(history.data?.from_cache === true);
        unsubscribeRef.current?.();
        unsubscribeRef.current = window.agenticxDesktop.onCollabRoomEvent((payload) => {
          if (payload.roomId !== activeRoomIdRef.current) return;
          if (payload.event.type === "room_message") {
            const incoming = asMessage(payload.event.message);
            if (incoming) setMessages((list) => withServerMessage(list, incoming));
            setStatus("live");
            onFromCacheRef.current?.(false);
            return;
          }
          if (payload.event.type === "outbox_sent") {
            const clientId = typeof payload.event.client_msg_id === "string" ? payload.event.client_msg_id : "";
            const incoming = asMessage(payload.event.message);
            if (incoming) {
              const message = incoming.client_msg_id ? incoming : { ...incoming, client_msg_id: clientId || null };
              setMessages((list) => withServerMessage(list, message));
            } else if (clientId) {
              setMessages((list) => list.filter((item) => item.client_msg_id !== clientId && item.id !== clientId));
            }
            onFromCacheRef.current?.(false);
            return;
          }
          if (payload.event.type === "outbox_failed") {
            const clientId = typeof payload.event.client_msg_id === "string" ? payload.event.client_msg_id : "";
            if (clientId) {
              setMessages((list) =>
                list.map((item) => (item.client_msg_id === clientId ? { ...item, status: "failed" } : item)),
              );
            }
            return;
          }
          if (payload.event.type === "room_closed" && payload.event.reason === "gone") {
            setStatus("revoked");
            onRevokedRef.current?.();
            return;
          }
          if (payload.event.type === "room_closed" && payload.event.reason === "retry") {
            setStatus("retrying");
            return;
          }
          if (payload.event.type === "room_ping" || payload.event.type === "room_cursor") {
            setStatus("live");
            onFromCacheRef.current?.(false);
          }
        });
        const watch = await window.agenticxDesktop.collabRoomWatch(roomId);
        if (cancelled || activeRoomIdRef.current !== roomId) return;
        if (!watch.ok) {
          setRoomError(watch.error || i18n.t("collab.unavailable", { ns: "workspace" }));
          setStatus("error");
          return;
        }
        setStatus("live");
      } catch {
        if (cancelled) return;
        setRoomError(i18n.t("collab.unavailable", { ns: "workspace" }));
        setStatus("error");
      }
    };
    void run();
    return () => {
      cancelled = true;
      void stopWatch(roomId);
    };
  }, [reloadToken, roomId, stopWatch]);

  useEffect(() => {
    if (status !== "live" && status !== "retrying") return;
    const id = roomId;
    void refreshSnapshot(id);
    const timer = window.setInterval(() => {
      void refreshSnapshot(id);
    }, MEMBER_POLL_MS);
    return () => window.clearInterval(timer);
  }, [roomId, status, refreshSnapshot]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, roomId]);

  const onSend = async () => {
    let text = "";
    if (roomCommand?.kind === "local") {
      const parsed = parsePerfCommandInput(draft, "");
      if (!parsed) {
        setPerfCard(perfCardError(
          draft.trim() ? tChat("composer.commands.invalidSession") : tChat("composer.commands.placeholderPerfRoom"),
        ));
        return;
      }
      try {
        const summary = await fetchSessionPerf(apiBase, apiToken, parsed.sessionId);
        text = buildPerfDiagnosisText(summary, parsed.note);
      } catch (err) {
        setPerfCard(perfCardError(err instanceof Error ? err.message : tChat("composer.commands.missing")));
        return;
      }
      if (!text) {
        setPerfCard(perfCardError(tChat("composer.commands.noRuns")));
        return;
      }
    } else {
      text = composeRoomCommandSend(roomCommand, draft).trim();
    }
    if (!roomId || !text || status === "revoked") return;
    const clientMsgId = crypto.randomUUID();
    setSendError(null);
    setDraft("");
    setRoomCommand(null);
    placeOptimistic(text, clientMsgId);
    const queued = sendChainRef.current.then(() => deliver(text, clientMsgId));
    sendChainRef.current = queued.catch(() => undefined);
  };

  const placeOptimistic = (text: string, clientMsgId: string) => {
    const optimistic: ConversationMessage = {
      id: clientMsgId,
      room_id: roomId,
      seq: Number.MAX_SAFE_INTEGER,
      sender_type: "human",
      sender_id: viewerUserId,
      sender_name: i18n.t("collab.me", { ns: "workspace" }),
      content: text,
      client_msg_id: clientMsgId,
      status: "pending",
    };
    setMessages((list) => {
      const without = list.filter((item) => item.client_msg_id !== clientMsgId && item.id !== clientMsgId);
      return placeMessage(without, optimistic);
    });
  };

  const deliver = async (text: string, clientMsgId: string) => {
    placeOptimistic(text, clientMsgId);
    const markFailed = () => {
      setMessages((list) => list.map((item) => (item.client_msg_id === clientMsgId ? { ...item, status: "failed" } : item)));
    };
    try {
      const res = await window.agenticxDesktop.collabRoomSend(roomId, text, clientMsgId);
      if (activeRoomIdRef.current !== roomId) return;
      if (!res.ok) {
        markFailed();
        return;
      }
      if (res.data?.pending) {
        onFromCacheRef.current?.(true);
        setMessages((list) =>
          list.map((item) => (item.client_msg_id === clientMsgId ? { ...item, status: "pending" } : item)),
        );
        return;
      }
      const server = asMessage(res.data?.message);
      if (!server) {
        markFailed();
        return;
      }
      const confirmed = server.client_msg_id ? server : { ...server, client_msg_id: clientMsgId };
      setMessages((list) => withServerMessage(list, confirmed));
      onFromCacheRef.current?.(false);
    } catch {
      if (activeRoomIdRef.current !== roomId) return;
      markFailed();
    }
  };

  const retrySend = (message: ConversationMessage) => {
    const clientMsgId = message.client_msg_id;
    if (!clientMsgId || message.status === "pending") return;
    void deliver(message.content, clientMsgId);
  };

  const approveMerge = async (message: RoomMessage) => {
    try {
      const res = await window.agenticxDesktop.collabRoomApproveMerge(roomId, message.seq);
      if (!res.ok) {
        setSendError(res.error || i18n.t("collab.unavailable", { ns: "workspace" }));
        return;
      }
      setApprovedSeqs((prev) => {
        const next = new Set(prev);
        next.add(message.seq);
        return next;
      });
    } catch {
      setSendError(i18n.t("collab.unavailable", { ns: "workspace" }));
    }
  };

  const needle = textQuery.trim().toLowerCase();
  const shown = needle
    ? messages.filter((message) => visibleContent(message.content).toLowerCase().includes(needle))
    : messages;
  const memberNames = members.map((item) => item.display_name).filter(Boolean);
  const revoked = status === "revoked";

  const statusText =
    status === "connecting"
      ? t("collab.statusConnecting")
      : status === "live"
        ? t("collab.statusLive")
        : status === "retrying"
          ? t("collab.statusRetrying")
          : status === "revoked"
            ? t("collab.revoked")
            : t("collab.unavailable");

  if (revoked) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-base font-medium text-text-strong">{t("collab.revoked")}</p>
        <button
          type="button"
          className="rounded-md border border-border bg-surface-card px-3 py-1.5 text-sm text-text-strong"
          onClick={() => onBack?.()}
        >
          {t("collab.backToList")}
        </button>
      </div>
    );
  }

  const renderRow = (message: RoomMessage) => {
    const kind = bubbleKind(message, viewerUserId);
    const custom = renderMessageExtra?.(message) ?? null;
    const metaKind = message.metadata?.kind;
    const requestedBy = typeof message.metadata?.requested_by === "string" ? message.metadata.requested_by : "";
    const showApprove =
      !custom &&
      metaKind === "merge_request" &&
      requestedBy.length > 0 &&
      requestedBy !== viewerUserId &&
      !approvedSeqs.has(message.seq);
    const mergeBack = !custom && metaKind === "merge_back";
    const replaceNode = custom ?? (mergeBack ? <MergeBackCard message={message} onViewSource={onViewSource} /> : null);
    const approveNode = showApprove ? (
      <button
        type="button"
        className="mt-1 rounded-md border border-border bg-surface-card px-2 py-1 text-[11px] text-text-strong"
        onClick={() => void approveMerge(message)}
      >
        {tProjects("merge.approve")}
      </button>
    ) : null;
    const checkbox = selectable ? (
      <input
        type="checkbox"
        className="mr-2 mt-2"
        aria-label={tProjects("select")}
        checked={selectedIds?.has(message.id) ?? false}
        onChange={() => onToggleSelect?.(message.id)}
      />
    ) : null;

    if (kind === "system" && !selectable && !replaceNode && !approveNode) {
      return (
        <div key={message.id} className="text-center text-xs text-text-faint whitespace-pre-wrap">
          {visibleContent(message.content)}
        </div>
      );
    }

    if (kind === "system") {
      return (
        <div key={message.id} className={selectable ? "flex items-start gap-2" : undefined}>
          {checkbox}
          <div className={selectable ? "min-w-0 flex-1" : undefined}>
            {replaceNode ? (
              <div className="flex justify-start">{replaceNode}</div>
            ) : (
              <div className="text-center text-xs text-text-faint whitespace-pre-wrap">
                {visibleContent(message.content)}
                {approveNode}
              </div>
            )}
          </div>
        </div>
      );
    }

    const mine = kind === "self";
    const rowClass = selectable
      ? `flex items-start ${mine ? "justify-end" : "justify-start"}`
      : `flex ${mine ? "justify-end" : "justify-start"}`;
    return (
      <div key={message.id} className={rowClass}>
        {checkbox}
        <div
          className={[
            "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
            mine
              ? "bg-[var(--chat-im-user-bg)] text-[var(--chat-im-user-text)]"
              : kind === "meta"
                ? "border border-border bg-surface-card text-text-primary"
                : "bg-surface-card text-text-primary",
          ].join(" ")}
        >
          <div className="mb-1 text-[11px] text-text-faint">
            {kind === "meta" ? "Meta" : mine ? t("collab.me") : message.sender_name || t("collab.member")}
          </div>
          {replaceNode ? (
            replaceNode
          ) : (
            <div className="whitespace-pre-wrap break-words">{visibleContent(message.content)}</div>
          )}
          {approveNode}
          <DeliveryMark message={message} onRetry={retrySend} />
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="truncate text-sm font-semibold text-text-strong">{room?.title ?? t("collab.collabRoom")}</h3>
          {headerTrailing ? (
            <div className="flex shrink-0 items-center gap-2">
              {headerTrailing}
              {showStatus ? <span className="text-[11px] text-text-faint">{statusText}</span> : null}
            </div>
          ) : showStatus ? (
            <span className="shrink-0 text-[11px] text-text-faint">{statusText}</span>
          ) : null}
        </div>
        <p className="mt-1 truncate text-[11px] text-text-faint">
          {t("collab.memberCount", { count: members.length })}
          {memberNames.length ? ` · ${memberNames.join("、")}` : ""}
        </p>
      </div>
      {roomError ? <p className="px-4 py-2 text-sm text-text-primary">{roomError}</p> : null}
      <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {shown.map((message) => renderRow(message))}
        <div ref={bottomRef} />
      </div>
      {selectionBar ? <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">{selectionBar}</div> : null}
      <form
        className="relative flex items-end gap-2 border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void onSend();
        }}
      >
        {perfCard ? (
          <div className="absolute bottom-full left-3 right-3">
            <CommandPerfCard
              error={perfCard.error}
              onClose={() => setPerfCard(null)}
            />
          </div>
        ) : null}
        {slashOpen ? (
          <CommandMenu
            items={commandItems}
            query={slashQuery ?? ""}
            canPin={false}
            onSelect={(item) => {
              setRoomCommand(item);
              setDraft("");
            }}
          />
        ) : null}
        {roomCommand ? (
          <button
            type="button"
            className="shrink-0 rounded-full bg-surface-hover px-2 py-1 text-[12px]"
            onClick={() => setRoomCommand(null)}
          >
            /{roomCommand.name}
          </button>
        ) : null}
        <input
          className="min-w-0 flex-1 rounded-md border border-border bg-surface-card px-3 py-2 text-sm text-text-primary outline-none"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            roomCommand
              ? roomCommand.kind === "local"
                ? tChat("composer.commands.placeholderPerfRoom")
                : tChat("composer.commands.placeholderPrompt")
              : t("collab.inputPlaceholder")
          }
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (slashOpen) {
                const filtered = commandItems.filter((item) =>
                  (slashQuery ?? "") === "" ? true : item.name.includes(slashQuery ?? ""),
                );
                if (filtered[0]) {
                  setRoomCommand(filtered[0]);
                  setDraft("");
                  return;
                }
              }
              void onSend();
            }
          }}
        />
        <button
          type="submit"
          className="shrink-0 rounded-md border border-border bg-surface-card-strong px-3 py-2 text-sm text-text-strong disabled:opacity-50"
          disabled={(!draft.trim() && roomCommand?.kind !== "prompt")}
        >
          {t("collab.send")}
        </button>
      </form>
      {sendError ? <p className="px-3 pb-3 text-xs text-text-primary">{sendError}</p> : null}
    </div>
  );
}
