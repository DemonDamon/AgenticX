"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from "@agenticx/ui";
import type { CollabRoomMember } from "../../lib/collab-room/types";

type RoomMembersPanelProps = {
  roomId: string;
  currentUserId: string;
  members: CollabRoomMember[];
  onChanged: () => void;
};

function memberLabel(member: CollabRoomMember, metaLabel: string): string {
  if (member.member_type === "meta") return metaLabel;
  return member.display_name || member.member_id;
}

export function RoomMembersPanel({ roomId, currentUserId, members, onChanged }: RoomMembersPanelProps) {
  const t = useTranslations("rooms");
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
        throw new Error(t("userNotFound"));
      }
      setUserId("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("addFailed"));
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
      if (!res.ok) throw new Error(t("leaveFailed"));
      window.location.href = "/rooms";
    } catch (err) {
      setError(err instanceof Error ? err.message : t("leaveFailedShort"));
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
      if (!res.ok) throw new Error(t("removeFailed"));
      setRemoveTarget(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("removeFailedShort"));
    } finally {
      setBusy(false);
    }
  };

  const humans = members.filter((item) => item.member_type === "human");
  const others = members.filter((item) => item.member_type !== "human");
  const metaLabel = t("metaAssistant");

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-card/40 p-4">
      <div>
        <h2 className="text-sm font-semibold">{t("membersTitle")}</h2>
        <p className="text-xs text-muted-foreground">{t("memberCount", { count: members.length })}</p>
      </div>
      <ul className="space-y-2 text-sm">
        {[...others, ...humans].map((member) => (
          <li key={`${member.member_type}:${member.member_id}`} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              {memberLabel(member, metaLabel)}
              {member.room_role === "owner" ? (
                <span className="ml-1 text-xs text-muted-foreground">{t("owner")}</span>
              ) : null}
            </span>
            {member.member_type === "human" && member.member_id !== currentUserId ? (
              <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(member)}>
                {t("remove")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="space-y-2">
        <Input
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          placeholder={t("addEmailPlaceholder")}
        />
        <Button variant="outline" className="w-full" onClick={() => void addMember()} disabled={adding}>
          {adding ? t("adding") : t("addMember")}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button variant="outline" onClick={() => setLeaveOpen(true)}>
        {t("leaveRoom")}
      </Button>

      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("leaveRoom")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("leaveConfirm")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaveOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void leave()} disabled={busy}>
              {t("leaveRoom")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(removeTarget)} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("removeMemberTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("removeConfirm", { name: removeTarget ? memberLabel(removeTarget, metaLabel) : "" })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void remove()} disabled={busy}>
              {t("remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
