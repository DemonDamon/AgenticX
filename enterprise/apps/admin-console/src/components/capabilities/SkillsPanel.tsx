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
import { Boxes, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { CapabilityChoiceList } from "./CapabilityChoiceList";
import { toggleId, useCapabilityCatalog, type SkillRecord } from "./use-capability-catalog";

export function SkillsPanel() {
  const t = useTranslations("pages.admin.capabilityPacks");
  const tc = useTranslations("common");
  const catalog = useCapabilityCatalog(t("toast.loadFailed"), tc("states.error"));

  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<SkillRecord | null>(null);
  const [draft, setDraft] = useState({
    displayName: "",
    description: "",
    version: "",
    bundleUri: "",
    bundleDigest: "",
  });
  const [requires, setRequires] = useState<string[]>([]);

  function openEditor(skill: SkillRecord) {
    setEditing(skill);
    setDraft({
      displayName: skill.displayName,
      description: skill.description,
      version: skill.version,
      bundleUri: skill.bundleUri,
      bundleDigest: skill.bundleDigest,
    });
    setRequires([...skill.requiredCapabilities]);
  }

  async function save() {
    if (!editing) return;
    const ok = await catalog.send(`/api/admin/skills/${editing.id}`, "PATCH", {
      ...draft,
      requiredCapabilities: requires,
    });
    if (ok) {
      setEditing(null);
      toast.success(t("toast.saved"));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Boxes className="size-4" /> {t("skills.createTitle")}
          </CardTitle>
          <CardDescription>{t("skills.createDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="skill-slug">{t("skills.slug")}</Label>
              <Input
                id="skill-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="research"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="skill-name">{t("skills.displayName")}</Label>
              <Input id="skill-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button
              onClick={async () => {
                if (!slug.trim()) {
                  toast.error(t("skills.slugRequired"));
                  return;
                }
                const ok = await catalog.send("/api/admin/skills", "POST", {
                  slug: slug.trim(),
                  displayName: name.trim() || undefined,
                });
                if (ok) {
                  setSlug("");
                  setName("");
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
          {!catalog.loading && catalog.skills.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("skills.empty")}</p>
          )}
          {catalog.skills.map((skill) => (
            <div
              key={skill.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
            >
              <div>
                <div className="font-medium">{skill.displayName || skill.slug}</div>
                <div className="text-xs text-muted-foreground">
                  {skill.slug} · {skill.version} ·{" "}
                  {t("skills.requiresCount", { count: skill.requiredCapabilities.length })}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={skill.status === "active" ? "default" : "secondary"}>
                  {skill.status === "active" ? t("status.active") : t("status.disabled")}
                </Badge>
                <Button size="sm" variant="outline" onClick={() => openEditor(skill)}>
                  {t("actions.edit")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void catalog.send(`/api/admin/skills/${skill.id}`, "PATCH", {
                      status: skill.status === "active" ? "disabled" : "active",
                    })
                  }
                >
                  {skill.status === "active" ? t("actions.disable") : t("actions.enable")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!confirm(t("skills.confirmDelete"))) return;
                    void catalog.send(`/api/admin/skills/${skill.id}`, "DELETE");
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("skills.editTitle", { name: editing?.slug ?? "" })}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="edit-skill-name">{t("skills.displayName")}</Label>
                  <Input
                    id="edit-skill-name"
                    value={draft.displayName}
                    onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-skill-version">{t("skills.version")}</Label>
                  <Input
                    id="edit-skill-version"
                    value={draft.version}
                    onChange={(e) => setDraft({ ...draft, version: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-skill-uri">{t("skills.bundleUri")}</Label>
                <Input
                  id="edit-skill-uri"
                  value={draft.bundleUri}
                  onChange={(e) => setDraft({ ...draft, bundleUri: e.target.value })}
                  placeholder="https://.../SKILL.md"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-skill-digest">{t("skills.bundleDigest")}</Label>
                <Input
                  id="edit-skill-digest"
                  value={draft.bundleDigest}
                  onChange={(e) => setDraft({ ...draft, bundleDigest: e.target.value })}
                  placeholder="sha256 hex"
                />
                <p className="text-xs text-muted-foreground">{t("skills.bundleDigestHint")}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-skill-desc">{t("skills.description")}</Label>
                <Textarea
                  id="edit-skill-desc"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
              <div className="space-y-2 rounded-lg border p-3">
                <div className="text-xs font-medium text-muted-foreground">{t("skills.requires")}</div>
                <p className="text-xs text-muted-foreground">{t("skills.requiresHint")}</p>
                <CapabilityChoiceList
                  items={catalog.grouped.mcp}
                  selected={requires}
                  onToggle={(id) => setRequires((prev) => toggleId(prev, id))}
                  emptyLabel={t("member.noMcp")}
                  disabledLabel={t("member.disabled")}
                />
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
