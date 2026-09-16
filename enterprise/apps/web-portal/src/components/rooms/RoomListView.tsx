"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button, Card, CardContent, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from "@agenticx/ui";
import type { CollabRoom } from "../../lib/collab-room/types";

type RoomListViewProps = {
  currentUserEmail: string;
};

type Envelope<T> = { data?: T; error?: { message?: string } };

export function formatRoomTime(
  iso: string | undefined,
  locale: string,
  emptyLabel: string,
): string {
  if (!iso) return emptyLabel;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return emptyLabel;
  const tag = locale.toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
  return date.toLocaleString(tag, { hour12: false });
}

export function RoomListView({ currentUserEmail }: RoomListViewProps) {
  const router = useRouter();
  const t = useTranslations("rooms");
  const locale = useLocale();
  const [rooms, setRooms] = useState<CollabRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setError("");
    try {
      const res = await fetch("/api/rooms", { cache: "no-store" });
      const body = (await res.json()) as Envelope<{ rooms: CollabRoom[] }>;
      if (!res.ok) throw new Error(t("loadFailed"));
      setRooms(body.data?.rooms ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailedShort"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [t]);

  const onCreate = async () => {
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim() || t("defaultTitle") }),
      });
      const body = (await res.json()) as Envelope<{ room: CollabRoom }>;
      if (!res.ok || !body.data?.room) throw new Error(t("createFailed"));
      setCreateOpen(false);
      setTitle("");
      router.push(`/rooms/${body.data.room.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("createFailedShort"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="min-w-0">
            <Link href="/workspace" className="text-sm text-muted-foreground hover:text-foreground">
              {t("backToWorkspace")}
            </Link>
            <h1 className="mt-1 text-xl font-semibold">{t("title")}</h1>
            <p className="truncate text-xs text-muted-foreground">{currentUserEmail}</p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>{t("newRoom")}</Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}
        {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
        {!loading && rooms.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-start gap-3 py-10">
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
              <Button onClick={() => setCreateOpen(true)}>{t("newRoom")}</Button>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {rooms.map((room) => (
              <li key={room.id}>
                <Link
                  href={`/rooms/${room.id}`}
                  className="block w-full rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/60"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium">{room.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t("memberCount", { count: room.member_count })}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatRoomTime(room.last_message_at, locale, t("noMessages"))}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("newRoom")}</DialogTitle>
          </DialogHeader>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("roomNamePlaceholder")}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void onCreate()} disabled={creating}>
              {creating ? t("creating") : t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
