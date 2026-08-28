"use client";

import { useState } from "react";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from "@agenticx/ui";
import type { CollabRoomMember } from "../../lib/collab-room/types";

type RoomMembersPanelProps = {
  roomId: string;
  currentUserId: string;
  members: CollabRoomMember[];
  onChanged: () => void;
};

function memberLabel(member: CollabRoomMember): string {
  if (member.member_type === "meta") return "Meta（助手）";
  return member.display_name || member.member_id;
}

export function RoomMembersPanel({ roomId, currentUserId, members, onChanged }: RoomMembersPanelProps) {
  const [userId, setUserId] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<CollabRoomMember | null>(null);
  const [busy, setBusy] = useState(false);

  const addMember = async () => {
    const target = userId.trim();
    if (!target) return;
    setAdding(true);
    setError("");
    try {
      const res = await fetch(`/api/rooms/${roomId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: target }),
      });
      const body = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        throw new Error("找不到这个用户。请填写对方的登录邮箱，例如 alice2@agenticx.local");
      }
      setUserId("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加失败");
    } finally {
      setAdding(false);
    }
  };

  const leave = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/rooms/${roomId}/leave`, { method: "POST" });
      const body = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) throw new Error("离开失败，请稍后重试");
      window.location.href = "/rooms";
    } catch (err) {
      setError(err instanceof Error ? err.message : "离开失败");
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removeTarget) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/rooms/${roomId}/members/${removeTarget.member_id}`, {
        method: "DELETE",
      });
      const body = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) throw new Error("移出失败，请稍后重试");
      setRemoveTarget(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "移出失败");
    } finally {
      setBusy(false);
    }
  };

  const humans = members.filter((item) => item.member_type === "human");
  const others = members.filter((item) => item.member_type !== "human");

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-card/40 p-4">
      <div>
        <h2 className="text-sm font-semibold">成员</h2>
        <p className="text-xs text-muted-foreground">{members.length} 名成员</p>
      </div>
      <ul className="space-y-2 text-sm">
        {[...others, ...humans].map((member) => (
          <li key={`${member.member_type}:${member.member_id}`} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              {memberLabel(member)}
              {member.room_role === "owner" ? (
                <span className="ml-1 text-xs text-muted-foreground">房主</span>
              ) : null}
            </span>
            {member.member_type === "human" && member.member_id !== currentUserId ? (
              <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(member)}>
                移出
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="space-y-2">
        <Input
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          placeholder="输入对方登录邮箱"
        />
        <Button variant="outline" className="w-full" onClick={() => void addMember()} disabled={adding}>
          {adding ? "添加中…" : "添加成员"}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button variant="outline" onClick={() => setLeaveOpen(true)}>
        离开房间
      </Button>

      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>离开房间</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">离开后将无法继续看到这个房间，除非再次被加入。</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaveOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void leave()} disabled={busy}>
              离开房间
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(removeTarget)} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移出成员</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            确定将 {removeTarget ? memberLabel(removeTarget) : ""} 移出该房间？
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>
              取消
            </Button>
            <Button onClick={() => void remove()} disabled={busy}>
              移出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
