"use client";

import { useState } from "react";
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
  Switch,
  Textarea,
  toast,
} from "@agenticx/ui";
import { Package, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  capabilityLabel,
  danglingCapabilityIds,
  disabledMemberIds,
  fromAssignmentKeys,
  toAssignmentKeys,
  type AssignmentDraft,
} from "../../lib/capability-pack-form";
import { CapabilityChoiceList } from "./CapabilityChoiceList";
import { toggleId, useCapabilityCatalog, type PackRecord } from "./use-capability-catalog";

const EMPTY_ASSIGNMENT: AssignmentDraft = { allMembers: false, deptIds: [], userIds: [] };

export function CapabilityPacksPanel() {
  const t = useTranslations("pages.admin.capabilityPacks");
  const tc = useTranslations("common");
  const catalog = useCapabilityCatalog(t("toast.loadFailed"), tc("states.error"));

  const [packSlug, setPackSlug] = useState("");
  const [packName, setPackName] = useState("");
  const [editing, setEditing] = useState<PackRecord | null>(null);
  const [draft, setDraft] = useState({ displayName: "", description: "" });
  const [members, setMembers] = useState<string[]>([]);
  const [assignment, setAssignment] = useState<AssignmentDraft>(EMPTY_ASSIGNMENT);

  function openEditor(pack: PackRecord) {
    setEditing(pack);
    setDraft({ displayName: pack.displayName, description: pack.description });
    setMembers([...pack.capabilityIds]);
    setAssignment(fromAssignmentKeys(pack.assignmentKeys));
  }

  async function save() {
    if (!editing) return;
    const ok = await catalog.send(`/api/admin/capability-packs/${editing.id}`, "PATCH", {
      displayName: draft.displayName,
      description: draft.description,
      capabilityIds: members,
      assignmentKeys: toAssignmentKeys(assignment),
    });
    if (ok) {
      setEditing(null);
      toast.success(t("toast.saved"));
    }
  }

  const dangling = editing ? danglingCapabilityIds(members, catalog.choices) : [];
  const disabled = editing ? disabledMemberIds(members, catalog.choices) : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="size-4" /> {t("packs.createTitle")}
          </CardTitle>
          <CardDescription>{t("packs.createDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="pack-slug">{t("packs.slug")}</Label>
              <Input
                id="pack-slug"
                value={packSlug}
                onChange={(e) => setPackSlug(e.target.value)}
                placeholder="market-research"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pack-name">{t("packs.displayName")}</Label>
              <Input
                id="pack-name"
                value={packName}
                onChange={(e) => setPackName(e.target.value)}
                placeholder={t("packs.displayNamePlaceholder")}
              />
            </div>
            <Button
              onClick={async () => {
                if (!packSlug.trim()) {
                  toast.error(t("packs.slugRequired"));
                  return;
                }
                const ok = await catalog.send("/api/admin/capability-packs", "POST", {
                  slug: packSlug.trim(),
                  displayName: packName.trim() || undefined,
                });
                if (ok) {
                  setPackSlug("");
                  setPackName("");
                }
              }}
            >
              <Plus className="mr-1 size-4" /> {tc("actions.create")}
            </Button>
            <Button variant="outline" onClick={() => void catalog.load()} disabled={catalog.loading}>
              <RefreshCcw className="mr-1 size-4" /> {tc("actions.refresh")}
            </Button>
          </div>

          {catalog.loading && <p className="text-sm text-muted-foreground">{tc("states.loading")}</p>}
          {!catalog.loading && catalog.packs.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("packs.empty")}</p>
          )}
          {catalog.packs.map((pack) => (
            <div
              key={pack.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
            >
              <div>
                <div className="font-medium">{pack.displayName || pack.slug}</div>
                <div className="text-xs text-muted-foreground">
                  {pack.slug} · {t("packs.memberCount", { count: pack.capabilityIds.length })} ·{" "}
                  {pack.assignmentKeys.includes("all")
                    ? t("assignment.allMembers")
                    : t("packs.assignedCount", { count: pack.assignmentKeys.length })}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={pack.status === "active" ? "default" : "secondary"}>
                  {pack.status === "active" ? t("status.active") : t("status.disabled")}
                </Badge>
                <Button size="sm" variant="outline" onClick={() => openEditor(pack)}>
                  {t("actions.edit")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void catalog.send(`/api/admin/capability-packs/${pack.id}`, "PATCH", {
                      status: pack.status === "active" ? "disabled" : "active",
                    })
                  }
                >
                  {pack.status === "active" ? t("actions.disable") : t("actions.enable")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!confirm(t("packs.confirmDelete"))) return;
                    void catalog.send(`/api/admin/capability-packs/${pack.id}`, "DELETE");
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("packs.editTitle", { name: editing?.slug ?? "" })}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="edit-pack-name">{t("packs.displayName")}</Label>
                  <Input
                    id="edit-pack-name"
                    value={draft.displayName}
                    onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-pack-desc">{t("packs.description")}</Label>
                  <Textarea
                    id="edit-pack-desc"
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">{t("member.title")}</div>
                <p className="text-xs text-muted-foreground">{t("member.hint")}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 rounded-lg border p-3">
                    <div className="text-xs font-medium text-muted-foreground">MCP</div>
                    <CapabilityChoiceList
                      items={catalog.grouped.mcp}
                      selected={members}
                      onToggle={(id) => setMembers((prev) => toggleId(prev, id))}
                      emptyLabel={t("member.noMcp")}
                      disabledLabel={t("member.disabled")}
                    />
                  </div>
                  <div className="space-y-2 rounded-lg border p-3">
                    <div className="text-xs font-medium text-muted-foreground">Skill</div>
                    <CapabilityChoiceList
                      items={catalog.grouped.skill}
                      selected={members}
                      onToggle={(id) => setMembers((prev) => toggleId(prev, id))}
                      emptyLabel={t("member.noSkill")}
                      disabledLabel={t("member.disabled")}
                    />
                  </div>
                </div>
                {disabled.length > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    {t("member.disabledWarning", {
                      names: disabled.map((id) => capabilityLabel(id, catalog.choices)).join("、"),
                    })}
                  </p>
                )}
                {dangling.length > 0 && (
                  <p className="text-xs text-destructive">
                    {t("member.danglingWarning", { ids: dangling.join("、") })}
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <div className="text-sm font-medium">{t("assignment.title")}</div>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={assignment.allMembers}
                    onCheckedChange={(checked) =>
                      setAssignment({ ...assignment, allMembers: Boolean(checked) })
                    }
                  />
                  <span>{t("assignment.allMembers")}</span>
                </label>
                {assignment.allMembers ? (
                  <p className="text-xs text-muted-foreground">{t("assignment.allMembersHint")}</p>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 rounded-lg border p-3">
                      <div className="text-xs font-medium text-muted-foreground">
                        {t("assignment.departments")}
                      </div>
                      {catalog.depts.length === 0 && (
                        <p className="text-xs text-muted-foreground">{t("assignment.noDept")}</p>
                      )}
                      {catalog.depts.map((dept) => (
                        <label key={dept.id} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={assignment.deptIds.includes(dept.id)}
                            onCheckedChange={() =>
                              setAssignment((prev) => ({
                                ...prev,
                                deptIds: toggleId(prev.deptIds, dept.id),
                              }))
                            }
                          />
                          <span>{dept.name}</span>
                          <span className="text-xs text-muted-foreground">{dept.path}</span>
                        </label>
                      ))}
                      <p className="text-xs text-muted-foreground">{t("assignment.deptHint")}</p>
                    </div>
                    <div className="space-y-2 rounded-lg border p-3">
                      <div className="text-xs font-medium text-muted-foreground">
                        {t("assignment.users")}
                      </div>
                      {catalog.users.length === 0 && (
                        <p className="text-xs text-muted-foreground">{t("assignment.noUser")}</p>
                      )}
                      {catalog.users.map((user) => (
                        <label key={user.id} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={assignment.userIds.includes(user.id)}
                            onCheckedChange={() =>
                              setAssignment((prev) => ({
                                ...prev,
                                userIds: toggleId(prev.userIds, user.id),
                              }))
                            }
                          />
                          <span>{user.displayName || user.email}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={() => void save()}>{tc("actions.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
