"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  ScrollArea,
  Textarea,
  toast,
} from "@agenticx/ui";
import { Plus, RefreshCcw, Trash2, UsersRound } from "lucide-react";
import { useTranslations } from "next-intl";

import { adminFetch } from "../../lib/admin-client-auth";
import { groupAssignmentKey, groupPackBindingChanges } from "../../lib/capability-pack-form";

type GroupRow = {
  id: string;
  name: string;
  description?: string;
  memberIds: string[];
};

type UserRow = { id: string; email: string; displayName?: string };
type PackRow = { id: string; slug: string; displayName: string; status: string; assignmentKeys: string[] };

const EMPTY_FORM = { name: "", description: "", memberIds: [] as string[] };

export function UserGroupsPanel() {
  const t = useTranslations("pages.iam.userGroups");
  const tc = useTranslations("common");
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [packs, setPacks] = useState<PackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<GroupRow | "new" | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [packIds, setPackIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [groupRes, userRes, packRes] = await Promise.all([
        adminFetch("/api/admin/user-groups", { cache: "no-store" }),
        adminFetch("/api/admin/users?limit=200", { cache: "no-store" }),
        adminFetch("/api/admin/capability-packs", { cache: "no-store" }),
      ]);
      const groupJson = (await groupRes.json()) as { message?: string; data?: { items?: GroupRow[] } };
      if (!groupRes.ok) throw new Error(groupJson.message || t("toast.loadFailed"));
      setGroups(groupJson.data?.items ?? []);

      const userJson = (await userRes.json().catch(() => ({}))) as { data?: { items?: UserRow[] } };
      setUsers(userJson.data?.items ?? []);

      const packJson = (await packRes.json().catch(() => ({}))) as { data?: { packs?: PackRow[] } };
      setPacks((packJson.data?.packs ?? []).filter((pack) => pack.status === "active"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing("new");
    setForm({ ...EMPTY_FORM });
    setPackIds([]);
  }

  function openEdit(group: GroupRow) {
    setEditing(group);
    setForm({
      name: group.name,
      description: group.description ?? "",
      memberIds: [...group.memberIds],
    });
    setPackIds(
      packs.filter((pack) => pack.assignmentKeys.includes(groupAssignmentKey(group.id))).map((pack) => pack.id),
    );
  }

  async function applyPackBindings(groupId: string) {
    const changes = groupPackBindingChanges(packs, groupAssignmentKey(groupId), packIds);
    const failed: string[] = [];
    for (const change of changes) {
      const res = await adminFetch(`/api/admin/capability-packs/${encodeURIComponent(change.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assignmentKeys: change.assignmentKeys }),
      });
      if (!res.ok) failed.push(packs.find((pack) => pack.id === change.id)?.displayName ?? change.id);
    }
    if (failed.length > 0) toast.error(t("toast.packFailed", { names: failed.join("、") }));
    if (changes.length > 0) {
      const packRes = await adminFetch("/api/admin/capability-packs", { cache: "no-store" });
      const packJson = (await packRes.json().catch(() => ({}))) as { data?: { packs?: PackRow[] } };
      setPacks((packJson.data?.packs ?? []).filter((pack) => pack.status === "active"));
    }
  }

  async function save() {
    if (!editing || saving) return;
    if (!form.name.trim()) {
      toast.error(t("nameRequired"));
      return;
    }
    setSaving(true);
    try {
      const isNew = editing === "new";
      const res = await adminFetch(isNew ? "/api/admin/user-groups" : `/api/admin/user-groups/${editing.id}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || null,
          memberIds: form.memberIds,
        }),
      });
      const json = (await res.json()) as { message?: string; data?: { group?: { id?: string } } };
      if (!res.ok) throw new Error(json.message || t("toast.saveFailed"));
      const groupId = isNew ? json.data?.group?.id : editing.id;
      if (groupId) await applyPackBindings(groupId);
      toast.success(t("toast.saved"));
      setEditing(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing || editing === "new" || saving) return;
    if (!confirm(t("confirmDelete"))) return;
    setSaving(true);
    try {
      const res = await adminFetch(`/api/admin/user-groups/${editing.id}`, { method: "DELETE" });
      const json = (await res.json()) as { message?: string };
      if (!res.ok) throw new Error(json.message || t("toast.deleteFailed"));
      toast.success(t("toast.deleted"));
      setEditing(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.deleteFailed"));
    } finally {
      setSaving(false);
    }
  }

  function toggleMember(id: string) {
    setForm((current) => ({
      ...current,
      memberIds: current.memberIds.includes(id)
        ? current.memberIds.filter((memberId) => memberId !== id)
        : [...current.memberIds, id],
    }));
  }

  function togglePack(id: string) {
    setPackIds((current) => (current.includes(id) ? current.filter((packId) => packId !== id) : [...current, id]));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCcw className="mr-1 size-4" /> {tc("actions.refresh")}
        </Button>
        <Button onClick={openCreate}>
          <Plus className="mr-1 size-4" /> {t("create")}
        </Button>
      </div>

      {loading && <p className="text-sm text-muted-foreground">{tc("states.loading")}</p>}
      {!loading && groups.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((group) => {
          const bound = packs.filter((pack) => pack.assignmentKeys.includes(groupAssignmentKey(group.id)));
          return (
            <Card key={group.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UsersRound className="size-4" /> {group.name}
                </CardTitle>
                <CardDescription>{group.description || t("noDescription")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  {t("memberCount", { count: group.memberIds.length })} ·{" "}
                  {t("packCount", { count: bound.length })}
                </div>
                <div className="flex flex-wrap gap-1">
                  {bound.map((pack) => (
                    <Badge key={pack.id} variant="secondary">
                      {pack.displayName || pack.slug}
                    </Badge>
                  ))}
                </div>
                <Button size="sm" variant="outline" onClick={() => openEdit(group)}>
                  {t("edit")}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? t("createTitle") : t("editTitle")}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="group-name">{t("name")}</Label>
                <Input
                  id="group-name"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="group-desc">{t("description")}</Label>
                <Textarea
                  id="group-desc"
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                />
              </div>
              <div className="space-y-2 rounded-lg border p-3">
                <div className="text-xs font-medium text-muted-foreground">{t("members")}</div>
                {users.length === 0 && <p className="text-xs text-muted-foreground">{t("noUsers")}</p>}
                {users.map((user) => (
                  <label key={user.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.memberIds.includes(user.id)}
                      onCheckedChange={() => toggleMember(user.id)}
                    />
                    <span>{user.displayName || user.email}</span>
                  </label>
                ))}
              </div>
              <div className="space-y-2 rounded-lg border p-3">
                <div className="text-xs font-medium text-muted-foreground">{t("packs")}</div>
                <p className="text-xs text-muted-foreground">{t("packsHint")}</p>
                {packs.length === 0 && <p className="text-xs text-muted-foreground">{t("noPacks")}</p>}
                {packs.map((pack) => (
                  <label key={pack.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={packIds.includes(pack.id)}
                      onCheckedChange={() => togglePack(pack.id)}
                    />
                    <span>{pack.displayName || pack.slug}</span>
                  </label>
                ))}
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            {editing && editing !== "new" ? (
              <Button variant="outline" onClick={() => void remove()} disabled={saving}>
                <Trash2 className="mr-1 size-4" /> {tc("actions.delete")}
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setEditing(null)}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {tc("actions.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
