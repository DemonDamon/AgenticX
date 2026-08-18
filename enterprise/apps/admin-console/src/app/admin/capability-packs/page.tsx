"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  PageHeader,
  ScrollArea,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from "@agenticx/ui";
import { Boxes, Package, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { adminFetch } from "../../../lib/admin-client-auth";
import {
  capabilityLabel,
  danglingCapabilityIds,
  disabledMemberIds,
  fromAssignmentKeys,
  groupCapabilityChoices,
  mcpCapabilityId,
  skillCapabilityId,
  toAssignmentKeys,
  type AssignmentDraft,
  type CapabilityChoice,
} from "../../../lib/capability-pack-form";

type CapabilityStatus = "active" | "disabled";

type SkillRecord = {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  version: string;
  bundleUri: string;
  bundleDigest: string;
  requiredCapabilities: string[];
  status: CapabilityStatus;
};

type PackRecord = {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  status: CapabilityStatus;
  capabilityIds: string[];
  assignmentKeys: string[];
};

type McpServerRow = { id: string; name: string; displayName: string; status: string };
type DeptRow = { id: string; name: string; path: string };
type UserRow = { id: string; email: string; displayName?: string };

const EMPTY_ASSIGNMENT: AssignmentDraft = { allMembers: false, deptIds: [], userIds: [] };

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export default function AdminCapabilityPacksPage() {
  const t = useTranslations("pages.admin.capabilityPacks");
  const tc = useTranslations("common");

  const [packs, setPacks] = useState<PackRecord[]>([]);
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerRow[]>([]);
  const [depts, setDepts] = useState<DeptRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [packSlug, setPackSlug] = useState("");
  const [packName, setPackName] = useState("");
  const [skillSlug, setSkillSlug] = useState("");
  const [skillName, setSkillName] = useState("");

  const [editingPack, setEditingPack] = useState<PackRecord | null>(null);
  const [packDraft, setPackDraft] = useState({ displayName: "", description: "" });
  const [packMembers, setPackMembers] = useState<string[]>([]);
  const [assignment, setAssignment] = useState<AssignmentDraft>(EMPTY_ASSIGNMENT);

  const [editingSkill, setEditingSkill] = useState<SkillRecord | null>(null);
  const [skillDraft, setSkillDraft] = useState({
    displayName: "",
    description: "",
    version: "",
    bundleUri: "",
    bundleDigest: "",
  });
  const [skillRequires, setSkillRequires] = useState<string[]>([]);

  const choices: CapabilityChoice[] = useMemo(() => {
    const mcp = mcpServers.map((server) => ({
      id: mcpCapabilityId(server.id),
      kind: "mcp" as const,
      name: server.name,
      displayName: server.displayName || server.name,
      disabled: server.status !== "active",
    }));
    const skillChoices = skills.map((skill) => ({
      id: skillCapabilityId(skill.id),
      kind: "skill" as const,
      name: skill.slug,
      displayName: skill.displayName || skill.slug,
      disabled: skill.status !== "active",
    }));
    return [...mcp, ...skillChoices];
  }, [mcpServers, skills]);

  const grouped = useMemo(() => groupCapabilityChoices(choices), [choices]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [packsRes, skillsRes, mcpRes, deptRes, userRes] = await Promise.all([
        adminFetch("/api/admin/capability-packs", { cache: "no-store" }),
        adminFetch("/api/admin/skills", { cache: "no-store" }),
        adminFetch("/api/admin/mcp-servers", { cache: "no-store" }),
        adminFetch("/api/admin/departments?shape=flat", { cache: "no-store" }),
        adminFetch("/api/admin/users?limit=200", { cache: "no-store" }),
      ]);
      const packsJson = (await packsRes.json()) as {
        message?: string;
        data?: { packs?: PackRecord[] };
      };
      if (!packsRes.ok) throw new Error(packsJson.message || t("toast.loadFailed"));
      setPacks(packsJson.data?.packs ?? []);

      const skillsJson = (await skillsRes.json()) as {
        message?: string;
        data?: { skills?: SkillRecord[] };
      };
      if (!skillsRes.ok) throw new Error(skillsJson.message || t("toast.loadFailed"));
      setSkills(skillsJson.data?.skills ?? []);

      const mcpJson = (await mcpRes.json().catch(() => ({}))) as {
        data?: { servers?: McpServerRow[] };
        servers?: McpServerRow[];
      };
      setMcpServers(mcpJson.data?.servers ?? mcpJson.servers ?? []);

      const deptJson = (await deptRes.json().catch(() => ({}))) as { data?: { items?: DeptRow[] } };
      setDepts(deptJson.data?.items ?? []);

      const userJson = (await userRes.json().catch(() => ({}))) as { data?: { items?: UserRow[] } };
      setUsers(userJson.data?.items ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(path: string, method: string, body?: unknown): Promise<boolean> {
    try {
      const res = await adminFetch(path, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(json.message || tc("states.error"));
      await load();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("states.error"));
      return false;
    }
  }

  function openPackEditor(pack: PackRecord) {
    setEditingPack(pack);
    setPackDraft({ displayName: pack.displayName, description: pack.description });
    setPackMembers([...pack.capabilityIds]);
    setAssignment(fromAssignmentKeys(pack.assignmentKeys));
  }

  function openSkillEditor(skill: SkillRecord) {
    setEditingSkill(skill);
    setSkillDraft({
      displayName: skill.displayName,
      description: skill.description,
      version: skill.version,
      bundleUri: skill.bundleUri,
      bundleDigest: skill.bundleDigest,
    });
    setSkillRequires([...skill.requiredCapabilities]);
  }

  async function savePack() {
    if (!editingPack) return;
    const ok = await send(`/api/admin/capability-packs/${editingPack.id}`, "PATCH", {
      displayName: packDraft.displayName,
      description: packDraft.description,
      capabilityIds: packMembers,
      assignmentKeys: toAssignmentKeys(assignment),
    });
    if (ok) {
      setEditingPack(null);
      toast.success(t("toast.saved"));
    }
  }

  async function saveSkill() {
    if (!editingSkill) return;
    const ok = await send(`/api/admin/skills/${editingSkill.id}`, "PATCH", {
      ...skillDraft,
      requiredCapabilities: skillRequires,
    });
    if (ok) {
      setEditingSkill(null);
      toast.success(t("toast.saved"));
    }
  }

  const packDangling = editingPack ? danglingCapabilityIds(packMembers, choices) : [];
  const packDisabled = editingPack ? disabledMemberIds(packMembers, choices) : [];

  function renderChoiceList(
    items: CapabilityChoice[],
    selected: string[],
    onToggle: (id: string) => void,
    emptyLabel: string,
  ) {
    if (items.length === 0) {
      return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
    }
    return (
      <div className="space-y-2">
        {items.map((item) => (
          <label key={item.id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={selected.includes(item.id)} onCheckedChange={() => onToggle(item.id)} />
            <span>{item.displayName}</span>
            <span className="text-xs text-muted-foreground">{item.name}</span>
            {item.disabled && <Badge variant="secondary">{t("member.disabled")}</Badge>}
          </label>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t("title")} description={t("description")} />

      <Tabs defaultValue="packs">
        <TabsList>
          <TabsTrigger value="packs">{t("tabs.packs")}</TabsTrigger>
          <TabsTrigger value="skills">{t("tabs.skills")}</TabsTrigger>
        </TabsList>

        <TabsContent value="packs" className="space-y-4 pt-4">
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
                    const ok = await send("/api/admin/capability-packs", "POST", {
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
                <Button variant="outline" onClick={() => void load()} disabled={loading}>
                  <RefreshCcw className="mr-1 size-4" /> {tc("actions.refresh")}
                </Button>
              </div>

              {loading && <p className="text-sm text-muted-foreground">{tc("states.loading")}</p>}
              {!loading && packs.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("packs.empty")}</p>
              )}
              {packs.map((pack) => (
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
                    <Button size="sm" variant="outline" onClick={() => openPackEditor(pack)}>
                      {t("actions.edit")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void send(`/api/admin/capability-packs/${pack.id}`, "PATCH", {
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
                        void send(`/api/admin/capability-packs/${pack.id}`, "DELETE");
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="skills" className="space-y-4 pt-4">
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
                    value={skillSlug}
                    onChange={(e) => setSkillSlug(e.target.value)}
                    placeholder="research"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="skill-name">{t("skills.displayName")}</Label>
                  <Input
                    id="skill-name"
                    value={skillName}
                    onChange={(e) => setSkillName(e.target.value)}
                  />
                </div>
                <Button
                  onClick={async () => {
                    if (!skillSlug.trim()) {
                      toast.error(t("skills.slugRequired"));
                      return;
                    }
                    const ok = await send("/api/admin/skills", "POST", {
                      slug: skillSlug.trim(),
                      displayName: skillName.trim() || undefined,
                    });
                    if (ok) {
                      setSkillSlug("");
                      setSkillName("");
                    }
                  }}
                >
                  <Plus className="mr-1 size-4" /> {tc("actions.create")}
                </Button>
              </div>

              {!loading && skills.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("skills.empty")}</p>
              )}
              {skills.map((skill) => (
                <div
                  key={skill.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <div>
                    <div className="font-medium">{skill.displayName || skill.slug}</div>
                    <div className="text-xs text-muted-foreground">
                      {skill.slug} · v{skill.version} ·{" "}
                      {t("skills.requiresCount", { count: skill.requiredCapabilities.length })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={skill.status === "active" ? "default" : "secondary"}>
                      {skill.status === "active" ? t("status.active") : t("status.disabled")}
                    </Badge>
                    <Button size="sm" variant="outline" onClick={() => openSkillEditor(skill)}>
                      {t("actions.edit")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void send(`/api/admin/skills/${skill.id}`, "PATCH", {
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
                        void send(`/api/admin/skills/${skill.id}`, "DELETE");
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(editingPack)} onOpenChange={(open) => !open && setEditingPack(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("packs.editTitle", { name: editingPack?.slug ?? "" })}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="edit-pack-name">{t("packs.displayName")}</Label>
                  <Input
                    id="edit-pack-name"
                    value={packDraft.displayName}
                    onChange={(e) => setPackDraft({ ...packDraft, displayName: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-pack-desc">{t("packs.description")}</Label>
                  <Textarea
                    id="edit-pack-desc"
                    value={packDraft.description}
                    onChange={(e) => setPackDraft({ ...packDraft, description: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">{t("member.title")}</div>
                <p className="text-xs text-muted-foreground">{t("member.hint")}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 rounded-lg border p-3">
                    <div className="text-xs font-medium text-muted-foreground">MCP</div>
                    {renderChoiceList(
                      grouped.mcp,
                      packMembers,
                      (id) => setPackMembers((prev) => toggle(prev, id)),
                      t("member.noMcp"),
                    )}
                  </div>
                  <div className="space-y-2 rounded-lg border p-3">
                    <div className="text-xs font-medium text-muted-foreground">Skill</div>
                    {renderChoiceList(
                      grouped.skill,
                      packMembers,
                      (id) => setPackMembers((prev) => toggle(prev, id)),
                      t("member.noSkill"),
                    )}
                  </div>
                </div>
                {packDisabled.length > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    {t("member.disabledWarning", {
                      names: packDisabled.map((id) => capabilityLabel(id, choices)).join("、"),
                    })}
                  </p>
                )}
                {packDangling.length > 0 && (
                  <p className="text-xs text-destructive">
                    {t("member.danglingWarning", { ids: packDangling.join("、") })}
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
                      {depts.length === 0 && (
                        <p className="text-xs text-muted-foreground">{t("assignment.noDept")}</p>
                      )}
                      {depts.map((dept) => (
                        <label key={dept.id} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={assignment.deptIds.includes(dept.id)}
                            onCheckedChange={() =>
                              setAssignment((prev) => ({
                                ...prev,
                                deptIds: toggle(prev.deptIds, dept.id),
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
                      {users.length === 0 && (
                        <p className="text-xs text-muted-foreground">{t("assignment.noUser")}</p>
                      )}
                      {users.map((user) => (
                        <label key={user.id} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={assignment.userIds.includes(user.id)}
                            onCheckedChange={() =>
                              setAssignment((prev) => ({
                                ...prev,
                                userIds: toggle(prev.userIds, user.id),
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
            <Button variant="outline" onClick={() => setEditingPack(null)}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={() => void savePack()}>{tc("actions.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingSkill)} onOpenChange={(open) => !open && setEditingSkill(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("skills.editTitle", { name: editingSkill?.slug ?? "" })}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="edit-skill-name">{t("skills.displayName")}</Label>
                  <Input
                    id="edit-skill-name"
                    value={skillDraft.displayName}
                    onChange={(e) => setSkillDraft({ ...skillDraft, displayName: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-skill-version">{t("skills.version")}</Label>
                  <Input
                    id="edit-skill-version"
                    value={skillDraft.version}
                    onChange={(e) => setSkillDraft({ ...skillDraft, version: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-skill-uri">{t("skills.bundleUri")}</Label>
                <Input
                  id="edit-skill-uri"
                  value={skillDraft.bundleUri}
                  onChange={(e) => setSkillDraft({ ...skillDraft, bundleUri: e.target.value })}
                  placeholder="https://.../SKILL.md"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-skill-digest">{t("skills.bundleDigest")}</Label>
                <Input
                  id="edit-skill-digest"
                  value={skillDraft.bundleDigest}
                  onChange={(e) => setSkillDraft({ ...skillDraft, bundleDigest: e.target.value })}
                  placeholder="sha256 hex"
                />
                <p className="text-xs text-muted-foreground">{t("skills.bundleDigestHint")}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-skill-desc">{t("skills.description")}</Label>
                <Textarea
                  id="edit-skill-desc"
                  value={skillDraft.description}
                  onChange={(e) => setSkillDraft({ ...skillDraft, description: e.target.value })}
                />
              </div>
              <div className="space-y-2 rounded-lg border p-3">
                <div className="text-xs font-medium text-muted-foreground">
                  {t("skills.requires")}
                </div>
                <p className="text-xs text-muted-foreground">{t("skills.requiresHint")}</p>
                {renderChoiceList(
                  grouped.mcp,
                  skillRequires,
                  (id) => setSkillRequires((prev) => toggle(prev, id)),
                  t("member.noMcp"),
                )}
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingSkill(null)}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={() => void saveSkill()}>{tc("actions.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
