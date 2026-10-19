"use client";

import { useEffect, useRef, useState, type UIEvent } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@agenticx/ui";
import type { CollabProject, CollabRoom, CollabRoomMessage } from "../../lib/collab-room/types";

type ProjectDetailViewProps = {
  projectId: string;
  currentUserEmail: string;
};

type Envelope<T> = { data?: T };

const MESSAGE_LIMIT = 50;

function formatTime(iso: string | null | undefined, locale: string, empty: string): string {
  if (!iso) return empty;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return empty;
  const tag = locale.toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
  return date.toLocaleString(tag, { hour12: false });
}

function mergeSourceTitle(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  if ((metadata as { kind?: unknown }).kind !== "merge_back") return null;
  const title = (metadata as { source_title?: unknown }).source_title;
  return typeof title === "string" ? title.trim() : "";
}

function orderedRooms(rooms: CollabRoom[]): {
  threaded: Array<{ room: CollabRoom; depth: number }>;
  directs: CollabRoom[];
  hasOrphanSubs: boolean;
} {
  const mains: CollabRoom[] = [];
  const subs: CollabRoom[] = [];
  const directs: CollabRoom[] = [];
  for (const room of rooms) {
    switch (room.room_kind) {
      case "main":
      case "room":
        mains.push(room);
        break;
      case "sub":
        subs.push(room);
        break;
      case "direct":
        directs.push(room);
        break;
      default: {
        const exhaustive: never = room.room_kind;
        void exhaustive;
        break;
      }
    }
  }
  const seen = new Set<string>();
  const threaded: Array<{ room: CollabRoom; depth: number }> = [];
  const walk = (parentId: string, depth: number) => {
    for (const room of subs) {
      if (room.parent_room_id !== parentId || seen.has(room.id)) continue;
      seen.add(room.id);
      threaded.push({ room, depth });
      walk(room.id, depth + 1);
    }
  };
  for (const room of mains) {
    threaded.push({ room, depth: 0 });
    walk(room.id, 1);
  }
  let hasOrphanSubs = false;
  for (const room of subs) {
    if (seen.has(room.id)) continue;
    hasOrphanSubs = true;
    seen.add(room.id);
    threaded.push({ room, depth: 1 });
    walk(room.id, 2);
  }
  return { threaded, directs, hasOrphanSubs };
}

export function ProjectDetailView({ projectId, currentUserEmail }: ProjectDetailViewProps) {
  const t = useTranslations("projects");
  const locale = useLocale();
  const [project, setProject] = useState<CollabProject | null>(null);
  const [rooms, setRooms] = useState<CollabRoom[]>([]);
  const [roomId, setRoomId] = useState("");
  const [messages, setMessages] = useState<CollabRoomMessage[]>([]);
  const [error, setError] = useState("");
  const [messagesError, setMessagesError] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const requestGen = useRef(0);
  const paging = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { cache: "no-store" });
        const body = (await res.json()) as Envelope<{ project: CollabProject; rooms: CollabRoom[] }>;
        if (!res.ok || !body.data?.project) throw new Error(t("openFailed"));
        if (cancelled) return;
        setProject(body.data.project);
        setRooms(body.data.rooms ?? []);
        const main = body.data.rooms?.find((room) => room.room_kind === "main");
        setRoomId(main?.id ?? body.data.rooms?.[0]?.id ?? "");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t("openFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, t]);

  useEffect(() => {
    if (!roomId) return;
    const gen = requestGen.current + 1;
    requestGen.current = gen;
    setLoadingMessages(true);
    setForbidden(false);
    setMessagesError("");
    setMessages([]);
    void (async () => {
      const params = new URLSearchParams({ limit: String(MESSAGE_LIMIT) });
      const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages?${params.toString()}`, {
        cache: "no-store",
      });
      if (requestGen.current !== gen) return;
      if (res.status === 403) {
        setForbidden(true);
        setMessages([]);
        setHasMore(false);
        setLoadingMessages(false);
        return;
      }
      if (!res.ok) {
        setMessagesError(t("messagesFailed"));
        setMessages([]);
        setHasMore(false);
        setLoadingMessages(false);
        return;
      }
      const body = (await res.json()) as Envelope<{ messages: CollabRoomMessage[] }>;
      const next = body.data?.messages ?? [];
      setMessages(next);
      setHasMore(next.length === MESSAGE_LIMIT);
      setLoadingMessages(false);
    })();
    return () => {
      if (requestGen.current === gen) requestGen.current += 1;
    };
  }, [roomId, t]);

  const loadMore = async () => {
    if (!roomId || !hasMore || loadingMore || loadingMessages || paging.current) return;
    const afterSeq = messages.at(-1)?.seq;
    if (afterSeq == null) return;
    const gen = requestGen.current;
    const targetRoomId = roomId;
    paging.current = true;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: String(MESSAGE_LIMIT), after_seq: String(afterSeq) });
      const res = await fetch(`/api/rooms/${encodeURIComponent(targetRoomId)}/messages?${params.toString()}`, {
        cache: "no-store",
      });
      if (requestGen.current !== gen) return;
      if (res.status === 403) {
        setForbidden(true);
        setMessages([]);
        setHasMore(false);
      } else if (!res.ok) {
        setMessagesError(t("messagesFailed"));
      } else {
        const body = (await res.json()) as Envelope<{ messages: CollabRoomMessage[] }>;
        const incoming = body.data?.messages ?? [];
        setMessages((prev) => {
          const seen = new Set(prev.map((item) => item.seq));
          return [...prev, ...incoming.filter((item) => !seen.has(item.seq))];
        });
        setHasMore(incoming.length === MESSAGE_LIMIT);
      }
    } finally {
      paging.current = false;
      if (requestGen.current === gen) setLoadingMore(false);
    }
  };

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 48) return;
    void loadMore();
  };

  const tree = orderedRooms(rooms);
  const selected = rooms.find((room) => room.id === roomId);
  const showForbidden = forbidden && selected?.room_kind === "direct";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto max-w-5xl">
          <Link href="/projects" className="text-sm text-muted-foreground hover:text-foreground">
            {t("backToList")}
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{project?.name ?? t("title")}</h1>
          <p className="truncate text-xs text-muted-foreground">{currentUserEmail}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t("desktopHint")}</p>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-6">
        {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}
        {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
        {!loading && !error ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            <aside className="max-h-[70vh] overflow-y-auto rounded-xl border border-border p-2">
              {rooms.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">{t("noRooms")}</p> : null}
              {tree.threaded.some((item) => item.depth === 0) ? (
                <p className="px-2 pt-1 text-xs font-medium text-muted-foreground">{t("mainGroup")}</p>
              ) : null}
              {tree.hasOrphanSubs && !tree.threaded.some((item) => item.room.room_kind === "main") ? (
                <p className="px-2 pt-1 text-xs font-medium text-muted-foreground">{t("subGroup")}</p>
              ) : null}
              {tree.threaded.map(({ room, depth }) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => setRoomId(room.id)}
                  className={[
                    "flex w-full items-center justify-between gap-2 rounded-md py-1.5 pr-2 text-left text-sm",
                    room.id === roomId ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                  ].join(" ")}
                  style={{ paddingLeft: 8 + depth * 12 }}
                >
                  <span className="truncate">{room.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t("memberCount", { count: room.member_count })}
                  </span>
                </button>
              ))}
              {tree.directs.length > 0 ? (
                <div className="mt-2">
                  <p className="px-2 pt-2 text-xs font-medium text-muted-foreground">{t("directGroup")}</p>
                  {tree.directs.map((room) => (
                    <button
                      key={room.id}
                      type="button"
                      onClick={() => setRoomId(room.id)}
                      className={[
                        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                        room.id === roomId ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                      ].join(" ")}
                    >
                      <span className="truncate">{room.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t("memberCount", { count: room.member_count })}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </aside>
            <section className="h-[70vh] overflow-y-auto rounded-xl border border-border p-4" onScroll={onScroll}>
              {!roomId ? <p className="text-sm text-muted-foreground">{t("selectRoom")}</p> : null}
              {loadingMessages ? <p className="text-sm text-muted-foreground">{t("loadingMessages")}</p> : null}
              {showForbidden ? <p className="text-sm text-muted-foreground">{t("directForbidden")}</p> : null}
              {forbidden && !showForbidden ? <p className="text-sm text-destructive">{t("messagesFailed")}</p> : null}
              {messagesError ? <p className="text-sm text-destructive">{messagesError}</p> : null}
              {!loadingMessages && !forbidden && roomId && messages.length === 0 && !messagesError ? (
                <p className="text-sm text-muted-foreground">{t("noMessages")}</p>
              ) : null}
              <div className="flex flex-col gap-3">
                {messages.map((message) => {
                  const merged = mergeSourceTitle(message.metadata);
                  if (merged != null) {
                    return (
                      <div key={message.id} className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                        <p className="text-sm font-medium">{merged ? t("mergeFrom", { title: merged }) : t("mergeUnknown")}</p>
                        {message.content ? <p className="mt-1 whitespace-pre-wrap text-sm">{message.content}</p> : null}
                      </div>
                    );
                  }
                  return (
                    <div key={message.id} className="rounded-lg px-1 py-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm font-medium">{message.sender_name}</p>
                        <p className="shrink-0 text-xs text-muted-foreground">
                          {formatTime(message.created_at, locale, t("noActivity"))}
                        </p>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{message.content}</p>
                    </div>
                  );
                })}
              </div>
              {hasMore && !loadingMessages && !forbidden ? (
                <div className="mt-3">
                  <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                    {t("loadMore")}
                  </Button>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}
