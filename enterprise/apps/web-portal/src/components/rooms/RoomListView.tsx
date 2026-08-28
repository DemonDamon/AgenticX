"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from "@agenticx/ui";
import type { CollabRoom } from "../../lib/collab-room/types";

type RoomListViewProps = {
  currentUserEmail: string;
};

type Envelope<T> = { data?: T; error?: { message?: string } };

function formatTime(iso?: string): string {
  if (!iso) return "暂无消息";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "暂无消息";
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function RoomListView({ currentUserEmail }: RoomListViewProps) {
  const router = useRouter();
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
      if (!res.ok) throw new Error("加载失败，请稍后重试");
      setRooms(body.data?.rooms ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onCreate = async () => {
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim() || "新房间" }),
      });
      const body = (await res.json()) as Envelope<{ room: CollabRoom }>;
      if (!res.ok || !body.data?.room) throw new Error("创建失败，请稍后重试");
      setCreateOpen(false);
      setTitle("");
      router.push(`/rooms/${body.data.room.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
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
              返回工作区
            </Link>
            <h1 className="mt-1 text-xl font-semibold">协作房间</h1>
            <p className="truncate text-xs text-muted-foreground">{currentUserEmail}</p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>新建房间</Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}
        {loading ? <p className="text-sm text-muted-foreground">正在加载…</p> : null}
        {!loading && rooms.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-start gap-3 py-10">
              <p className="text-sm text-muted-foreground">还没有房间。新建一间，邀请同事一起聊。</p>
              <Button onClick={() => setCreateOpen(true)}>新建房间</Button>
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
                    <span className="shrink-0 text-xs text-muted-foreground">{room.member_count} 名成员</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{formatTime(room.last_message_at)}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建房间</DialogTitle>
          </DialogHeader>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="房间名称"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void onCreate()} disabled={creating}>
              {creating ? "创建中…" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
