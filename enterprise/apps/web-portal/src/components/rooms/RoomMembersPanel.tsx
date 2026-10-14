"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Bot } from "lucide-react";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from "@agenticx/ui";
import type { CollabRoomMember } from "../../lib/collab-room/types";

type PortalAgent = {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  runtime: string;
  model: string;
};

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
  const [agents, setAgents] = useState<PortalAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState("");
  const [agentError, setAgentError] = useState("");
  const [addingAgentId, setAddingAgentId] = useState("");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<CollabRoomMember | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/me/agents", { cache: "no-store" });
        const body = (await res.json()) as {
          data?: { agents?: PortalAgent[] };
          error?: { message?: string };
        };
        if (!res.ok) throw new Error(body.error?.message || t("loadAgentsFailed"));
        if (!cancelled) {
          setAgents(body.data?.agents ?? []);
          setAgentsError("");
        }
      } catch (err) {
        if (!cancelled) {
          setAgentsError(err instanceof Error ? err.message : t("loadAgentsFailed"));
        }
      } finally {
        if (!cancelled) setAgentsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [t]);

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

  const addAgent = async (agentId: string) => {
    setAddingAgentId(agentId);
    setAgentError("");
    try {
      const res = await fetch(`/api/rooms/${roomId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: agentId }),
      });
      const body = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message || t("addAgentFailed"));
      onChanged();
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : t("addAgentFailed"));
    } finally {
      setAddingAgentId("");
    }
  };

  const humans = members.filter((item) => item.member_type === "human");
  const others = members.filter((item) => item.member_type !== "human");
  const metaLabel = t("metaAssistant");
  const joinedAgentIds = new Set(
    members
      .filter((member) => member.member_type === "agent" && !member.left_at)
      .map((member) => member.member_id),
  );
  const availableAgents = agents.filter((agent) => !joinedAgentIds.has(agent.id));

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-card/40 p-4">
      <div>
        <h2 className="text-sm font-semibold">{t("membersTitle")}</h2>
        <p className="text-xs text-muted-foreground">{t("memberCount", { count: members.length })}</p>
      </div>
      <ul className="space-y-2 text-sm">
        {[...others, ...humans].map((member) => (
          <li key={`${member.member_type}:${member.member_id}`} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1">
              {member.member_type === "agent" ? <Bot className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
              <span className="truncate">{memberLabel(member, metaLabel)}</span>
              {member.member_type === "agent" ? (
                <span className="shrink-0 text-xs text-muted-foreground">{t("agentBadge")}</span>
              ) : null}
              {member.room_role === "owner" ? (
                <span className="shrink-0 text-xs text-muted-foreground">{t("owner")}</span>
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
      <div className="space-y-2">
        <h3 className="flex items-center gap-1 text-sm font-semibold">
          <Bot className="h-3.5 w-3.5" aria-hidden />
          {t("addAgentSection")}
        </h3>
        {agentsLoading ? <p className="text-xs text-muted-foreground">{t("loading")}</p> : null}
        {agentsError ? <p className="text-xs text-destructive">{agentsError}</p> : null}
        {agentError ? <p className="text-xs text-destructive">{agentError}</p> : null}
        {!agentsLoading && !agentsError && availableAgents.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("noAgentsAvailable")}</p>
        ) : null}
        <ul className="space-y-1">
          {availableAgents.map((agent) => (
            <li key={agent.id}>
              <Button
                type="button"
                variant="outline"
                className="h-auto w-full justify-start py-2"
                disabled={addingAgentId === agent.id}
                onClick={() => void addAgent(agent.id)}
              >
                <span className="flex min-w-0 flex-col items-start">
                  <span className="truncate">{agent.displayName}</span>
                  <span className="text-[11px] font-normal text-muted-foreground">@{agent.slug}</span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      </div>
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
