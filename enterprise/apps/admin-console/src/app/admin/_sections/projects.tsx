"use client";

import { adminFetch } from "../../../lib/admin-client-auth";
import { Badge, Button, PageHeader } from "@agenticx/ui";
import { useCallback, useEffect, useRef, useState, type UIEvent } from "react";
import { useLocale, useTranslations } from "next-intl";

type AdminProjectRow = {
  id: string;
  name: string;
  owner_user_id: string;
  owner_name: string;
  dept_id: string | null;
  dept_name: string | null;
  member_count: number;
  room_count: number;
  message_count: number;
  last_activity_at: string | null;
  created_at: string;
  archived_at: string | null;
};

type RoomKind = "main" | "sub" | "direct";

type AdminProjectRoom = {
  id: string;
  title: string;
  room_kind: RoomKind;
  parent_room_id: string | null;
  member_count: number;
  message_count: number;
  last_seq: number;
};

type AdminProjectMember = {
  member_type: string;
  member_id: string;
  display_name: string;
  room_role: string;
};

type AdminProjectMessage = {
  seq: number;
  sender_type: string;
  sender_name: string;
  content: string;
  metadata: unknown;
  created_at: string;
};

type ProjectDetail = {
  project: AdminProjectRow;
  rooms: AdminProjectRoom[];
  members: AdminProjectMember[];
};

const MESSAGE_LIMIT = 50;
const PAGE_SIZE = 20;

function formatTime(iso: string | null, locale: string, empty: string): string {
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

function orderedRooms(rooms: AdminProjectRoom[]): {
  threaded: Array<{ room: AdminProjectRoom; depth: number }>;
  directs: AdminProjectRoom[];
  hasOrphanSubs: boolean;
} {
  const mains: AdminProjectRoom[] = [];
  const subs: AdminProjectRoom[] = [];
  const directs: AdminProjectRoom[] = [];
  for (const room of rooms) {
    switch (room.room_kind) {
      case "main":
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
  const threaded: Array<{ room: AdminProjectRoom; depth: number }> = [];
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

export default function ProjectsSection() {
  const t = useTranslations("pages.admin.projects");
  const locale = useLocale();
  const [items, setItems] = useState<AdminProjectRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [roomId, setRoomId] = useState("");
  const [messages, setMessages] = useState<AdminProjectMessage[]>([]);
  const [messagesError, setMessagesError] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const requestGen = useRef(0);
  const paging = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    if (applied) params.set("q", applied);
    const res = await adminFetch(`/api/admin/projects?${params.toString()}`, { cache: "no-store" });
    const json = (await res.json()) as { data?: { items?: AdminProjectRow[]; total?: number } };
    if (!res.ok) {
      setError(t("loadFailed"));
      setItems([]);
      setTotal(0);
    } else {
      setItems(json.data?.items ?? []);
      setTotal(json.data?.total ?? 0);
    }
    setLoading(false);
  }, [applied, page, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!detail) return;
    const main = detail.rooms.find((room) => room.room_kind === "main");
    setRoomId(main?.id ?? detail.rooms[0]?.id ?? "");
    setMessages([]);
    setForbidden(false);
    setMessagesError("");
    setHasMore(false);
  }, [detail]);

  const readMessages = useCallback(
    async (projectId: string, targetRoomId: string, afterSeq?: number) => {
      const params = new URLSearchParams({ limit: String(MESSAGE_LIMIT) });
      if (afterSeq != null) params.set("after_seq", String(afterSeq));
      const res = await adminFetch(
        `/api/admin/projects/${encodeURIComponent(projectId)}/rooms/${encodeURIComponent(targetRoomId)}/messages?${params.toString()}`,
        { cache: "no-store" },
      );
      if (res.status === 403) return { forbidden: true as const, messages: [] as AdminProjectMessage[] };
      if (!res.ok) return { forbidden: false as const, error: true as const, messages: [] as AdminProjectMessage[] };
      const json = (await res.json()) as { data?: { messages?: AdminProjectMessage[] } };
      return { forbidden: false as const, error: false as const, messages: json.data?.messages ?? [] };
    },
    [],
  );

  useEffect(() => {
    if (!detail || !roomId || !detail.rooms.some((room) => room.id === roomId)) return;
    const gen = requestGen.current + 1;
    requestGen.current = gen;
    setLoadingMessages(true);
    setForbidden(false);
    setMessagesError("");
    setMessages([]);
    void (async () => {
      const result = await readMessages(detail.project.id, roomId);
      if (requestGen.current !== gen) return;
      setForbidden(result.forbidden);
      setMessagesError("error" in result && result.error ? t("messagesFailed") : "");
      setMessages(result.messages);
      setHasMore(!result.forbidden && !("error" in result && result.error) && result.messages.length === MESSAGE_LIMIT);
      setLoadingMessages(false);
    })();
    return () => {
      if (requestGen.current === gen) requestGen.current += 1;
    };
  }, [detail, readMessages, roomId, t]);

  const openProject = async (id: string) => {
    setError("");
    setRoomId("");
    const res = await adminFetch(`/api/admin/projects/${encodeURIComponent(id)}`, { cache: "no-store" });
    const json = (await res.json()) as { data?: ProjectDetail };
    if (!res.ok || !json.data?.project) {
      setError(t("openFailed"));
      return;
    }
    setDetail(json.data);
  };

  const loadMore = async () => {
    if (!detail || !roomId || !hasMore || loadingMore || loadingMessages || paging.current) return;
    const afterSeq = messages.at(-1)?.seq;
    if (afterSeq == null) return;
    const gen = requestGen.current;
    const targetRoomId = roomId;
    paging.current = true;
    setLoadingMore(true);
    try {
      const result = await readMessages(detail.project.id, targetRoomId, afterSeq);
      if (requestGen.current !== gen) return;
      if (result.forbidden) {
        setForbidden(true);
        setMessages([]);
        setHasMore(false);
      } else if ("error" in result && result.error) {
        setMessagesError(t("messagesFailed"));
      } else {
        setMessages((prev) => {
          const seen = new Set(prev.map((item) => item.seq));
          return [...prev, ...result.messages.filter((item) => !seen.has(item.seq))];
        });
        setHasMore(result.messages.length === MESSAGE_LIMIT);
      }
    } finally {
      paging.current = false;
      if (requestGen.current === gen) setLoadingMore(false);
    }
  };

  const onMessagesScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 48) return;
    void loadMore();
  };

  const tree = detail ? orderedRooms(detail.rooms) : null;
  const nameSep = locale.toLowerCase().startsWith("en") ? ", " : "、";

  if (detail && tree) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDetail(null);
              setRoomId("");
              setMessages([]);
            }}
          >
            {t("back")}
          </Button>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground">{detail.project.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("ownerLabel")}：{detail.project.owner_name || t("noDept")}
              {" · "}
              {t("deptLabel")}：{detail.project.dept_name || t("noDept")}
              {" · "}
              {t("columns.members")} {detail.project.member_count}
              {" · "}
              {t("columns.rooms")} {detail.project.room_count}
              {" · "}
              {t("columns.messages")} {detail.project.message_count}
            </p>
            {detail.members.length > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("membersHeading")}：{detail.members.map((member) => member.display_name).join(nameSep)}
              </p>
            ) : null}
          </div>
          {detail.project.archived_at ? <Badge variant="secondary">{t("archived")}</Badge> : null}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="grid min-h-[70vh] grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="max-h-[70vh] overflow-y-auto rounded-xl border border-border p-2">
            {detail.rooms.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">{t("noRooms")}</p> : null}
            {tree.threaded.some((item) => item.room.room_kind === "main") ? (
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
                <span className="shrink-0 text-xs text-muted-foreground">{t("messageCount", { count: room.message_count })}</span>
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
                      {t("messageCount", { count: room.message_count })}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </aside>
          <section
            className="h-[70vh] overflow-y-auto rounded-xl border border-border p-4"
            onScroll={onMessagesScroll}
          >
            {!roomId ? <p className="text-sm text-muted-foreground">{t("selectRoom")}</p> : null}
            {loadingMessages ? <p className="text-sm text-muted-foreground">{t("loadingMessages")}</p> : null}
            {forbidden ? <p className="text-sm text-muted-foreground">{t("directForbidden")}</p> : null}
            {messagesError ? <p className="text-sm text-destructive">{messagesError}</p> : null}
            {!loadingMessages && !forbidden && roomId && messages.length === 0 && !messagesError ? (
              <p className="text-sm text-muted-foreground">{t("noMessages")}</p>
            ) : null}
            <div className="flex flex-col gap-3">
              {messages.map((message) => {
                const merged = mergeSourceTitle(message.metadata);
                if (merged != null) {
                  return (
                    <div key={message.seq} className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                      <p className="text-sm font-medium">
                        {merged ? t("mergeFrom", { title: merged }) : t("mergeUnknown")}
                      </p>
                      {message.content ? <p className="mt-1 whitespace-pre-wrap text-sm">{message.content}</p> : null}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatTime(message.created_at, locale, t("noActivity"))}
                      </p>
                    </div>
                  );
                }
                return (
                  <div key={message.seq} className="rounded-lg px-1 py-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-medium text-foreground">{message.sender_name}</p>
                      <p className="shrink-0 text-xs text-muted-foreground">
                        {formatTime(message.created_at, locale, t("noActivity"))}
                      </p>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{message.content}</p>
                  </div>
                );
              })}
            </div>
            {loadingMore ? <p className="mt-3 text-xs text-muted-foreground">{t("loadMore")}</p> : null}
            {hasMore && !loadingMessages && !forbidden ? (
              <div className="mt-3">
                <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                  {t("loadMore")}
                </Button>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <PageHeader title={t("title")} description={t("description")} />
      <form
        className="flex max-w-md gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setApplied(query.trim());
        }}
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
        />
        <Button type="submit" size="sm" variant="outline">
          {t("search")}
        </Button>
      </form>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
      {!loading && items.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      {items.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("columns.name")}</th>
                <th className="px-3 py-2 font-medium">{t("columns.owner")}</th>
                <th className="px-3 py-2 font-medium">{t("columns.dept")}</th>
                <th className="px-3 py-2 font-medium">{t("columns.members")}</th>
                <th className="px-3 py-2 font-medium">{t("columns.rooms")}</th>
                <th className="px-3 py-2 font-medium">{t("columns.messages")}</th>
                <th className="px-3 py-2 font-medium">{t("columns.activity")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  tabIndex={0}
                  className="cursor-pointer border-t border-border hover:bg-accent"
                  onClick={() => void openProject(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void openProject(item.id);
                    }
                  }}
                >
                  <td className="px-3 py-2 font-medium text-foreground">{item.name}</td>
                  <td className="px-3 py-2">{item.owner_name || t("noDept")}</td>
                  <td className="px-3 py-2">{item.dept_name || t("noDept")}</td>
                  <td className="px-3 py-2">{item.member_count}</td>
                  <td className="px-3 py-2">{item.room_count}</td>
                  <td className="px-3 py-2">{item.message_count}</td>
                  <td className="px-3 py-2">{formatTime(item.last_activity_at, locale, t("noActivity"))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {total > PAGE_SIZE ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{t("pageStatus", { page, total })}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
              {t("prev")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page * PAGE_SIZE >= total}
              onClick={() => setPage((current) => current + 1)}
            >
              {t("next")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
