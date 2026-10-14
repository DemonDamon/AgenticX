"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from "@agenticx/ui";
import { Bot } from "lucide-react";
import { useTranslations } from "next-intl";

import { AssignmentScopeEditor } from "../../../components/assignment/AssignmentScopeEditor";
import { useAssignmentDirectory } from "../../../components/assignment/useAssignmentDirectory";
import { adminFetch } from "../../../lib/admin-client-auth";
import {
  fromAssignmentKeys,
  mcpCapabilityId,
  skillCapabilityId,
  toAssignmentKeys,
  type AssignmentDraft,
} from "../../../lib/capability-pack-form";

type AgentRuntime = "cloud" | "desktop_worker";
type AgentStatus = "active" | "disabled";

type AgentRecord = {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  systemPrompt: string;
  model: string;
  runtime: AgentRuntime;
  capabilityIds: string[];
  assignmentKeys: string[];
  workerKeys: string[];
  status: AgentStatus;
  metadata?: Record<string, unknown>;
};

type ModelOption = { id: string; label: string };
type CapabilityOption = { id: string; label: string; detail: string; disabled: boolean };

type FormState = {
  slug: string;
  displayName: string;
  description: string;
  model: string;
  runtime: AgentRuntime;
  systemPrompt: string;
  knowledgeSearchUrl: string;
  metadata: Record<string, unknown>;
  capabilityIds: string[];
  assignment: AssignmentDraft;
  workerAssignment: AssignmentDraft;
  enabled: boolean;
};

type EditorState = { mode: "create" | "edit"; id?: string };

const EMPTY_ASSIGNMENT: AssignmentDraft = {
  allMembers: true,
  deptIds: [],
  groupIds: [],
  userIds: [],
};

const EMPTY_WORKER_ASSIGNMENT: AssignmentDraft = {
  allMembers: false,
  deptIds: [],
  groupIds: [],
  userIds: [],
};

const EMPTY_FORM: FormState = {
  slug: "",
  displayName: "",
  description: "",
  model: "",
  runtime: "cloud",
  systemPrompt: "",
  knowledgeSearchUrl: "",
  metadata: {},
  capabilityIds: [],
  assignment: EMPTY_ASSIGNMENT,
  workerAssignment: EMPTY_WORKER_ASSIGNMENT,
  enabled: true,
};

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

function safeCapabilityId(kind: "mcp" | "skill", id: string): string | null {
  try {
    return kind === "mcp" ? mcpCapabilityId(id) : skillCapabilityId(id);
  } catch {
    return null;
  }
}

function isRuntime(value: string): value is AgentRuntime {
  return value === "cloud" || value === "desktop_worker";
}

function isStatus(value: string): value is AgentStatus {
  return value === "active" || value === "disabled";
}

export default function AgentsSection() {
  const t = useTranslations("pages.admin.agents");
  const tc = useTranslations("common");
  const directory = useAssignmentDirectory();

  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [skills, setSkills] = useState<CapabilityOption[]>([]);
  const [mcpServers, setMcpServers] = useState<CapabilityOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AgentRecord | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [agentsRes, providersRes, skillsRes, mcpRes] = await Promise.all([
        adminFetch("/api/admin/agents", { cache: "no-store" }),
        adminFetch("/api/admin/providers", { cache: "no-store" }),
        adminFetch("/api/admin/skills", { cache: "no-store" }),
        adminFetch("/api/admin/mcp-servers", { cache: "no-store" }),
      ]);
      const agentsJson = (await agentsRes.json().catch(() => ({}))) as {
        message?: string;
        data?: { agents?: AgentRecord[] };
      };
      if (!agentsRes.ok) throw new Error(agentsJson.message || tc("toast.loadFailed"));
      setAgents(agentsJson.data?.agents ?? []);

      const providersJson = (await providersRes.json().catch(() => ({}))) as {
        data?: {
          providers?: Array<{
            id: string;
            displayName: string;
            enabled: boolean;
            models: Array<{ name: string; label: string; enabled: boolean }>;
          }>;
        };
      };
      const modelOptions: ModelOption[] = [];
      for (const provider of providersJson.data?.providers ?? []) {
        if (!provider.enabled) continue;
        for (const model of provider.models) {
          if (!model.enabled) continue;
          modelOptions.push({
            id: `${provider.id}/${model.name}`,
            label: `${provider.displayName || provider.id} / ${model.label || model.name}`,
          });
        }
      }
      setModels(modelOptions);

      const skillsJson = (await skillsRes.json().catch(() => ({}))) as {
        data?: { skills?: Array<{ id: string; slug: string; displayName: string; status: string }> };
      };
      setSkills(
        (skillsJson.data?.skills ?? []).flatMap((skill) => {
          const id = safeCapabilityId("skill", skill.id);
          if (!id) return [];
          return [
            {
              id,
              label: skill.displayName || skill.slug,
              detail: skill.slug,
              disabled: skill.status !== "active",
            },
          ];
        }),
      );

      const mcpJson = (await mcpRes.json().catch(() => ({}))) as {
        data?: { servers?: Array<{ id: string; name: string; displayName: string; status: string }> };
        servers?: Array<{ id: string; name: string; displayName: string; status: string }>;
      };
      const servers = mcpJson.data?.servers ?? mcpJson.servers ?? [];
      setMcpServers(
        servers.flatMap((server) => {
          const id = safeCapabilityId("mcp", server.id);
          if (!id) return [];
          return [
            {
              id,
              label: server.displayName || server.name,
              detail: server.name,
              disabled: server.status !== "active",
            },
          ];
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : tc("toast.loadFailed");
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [tc]);

  useEffect(() => {
    void load();
  }, [load]);

  const modelChoices = useMemo(() => {
    if (!form.model || models.some((item) => item.id === form.model)) return models;
    return [{ id: form.model, label: form.model }, ...models];
  }, [form.model, models]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError("");
    setEditor({ mode: "create" });
  }

  function openEdit(agent: AgentRecord) {
    setForm({
      slug: agent.slug,
      displayName: agent.displayName,
      description: agent.description ?? "",
      model: agent.model,
      runtime: isRuntime(agent.runtime) ? agent.runtime : "cloud",
      systemPrompt: agent.systemPrompt ?? "",
      knowledgeSearchUrl:
        typeof agent.metadata?.knowledgeSearchUrl === "string" ? agent.metadata.knowledgeSearchUrl : "",
      metadata: { ...(agent.metadata ?? {}) },
      capabilityIds: [...agent.capabilityIds],
      assignment: fromAssignmentKeys(agent.assignmentKeys),
      workerAssignment: fromAssignmentKeys(agent.workerKeys ?? []),
      enabled: agent.status !== "disabled",
    });
    setFormError("");
    setEditor({ mode: "edit", id: agent.id });
  }

  async function save() {
    if (!editor || saving) return;
    setSaving(true);
    setFormError("");
    const payload = {
      displayName: form.displayName,
      description: form.description,
      model: form.model,
      runtime: form.runtime,
      systemPrompt: form.systemPrompt,
      metadata: {
        ...form.metadata,
        knowledgeSearchUrl: form.knowledgeSearchUrl.trim(),
      },
      capabilityIds: form.capabilityIds,
      assignmentKeys: toAssignmentKeys(form.assignment),
      workerKeys: toAssignmentKeys(form.workerAssignment),
      status: (form.enabled ? "active" : "disabled") satisfies AgentStatus,
    };
    try {
      const res = await adminFetch(editor.mode === "create" ? "/api/admin/agents" : `/api/admin/agents/${editor.id}`, {
        method: editor.mode === "create" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editor.mode === "create" ? { ...payload, slug: form.slug } : payload),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setFormError(json.message || tc("toast.saveFailed"));
        return;
      }
      toast.success(editor.mode === "create" ? t("toast.created") : t("toast.saved"));
      setEditor(null);
      await load();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : tc("toast.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await adminFetch(`/api/admin/agents/${pendingDelete.id}`, { method: "DELETE" });
      const json = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setDeleteError(json.message || tc("toast.saveFailed"));
        return;
      }
      toast.success(t("toast.deleted"));
      setPendingDelete(null);
      await load();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : tc("toast.saveFailed"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={<Button onClick={openCreate}>{t("create")}</Button>}
      />

      {loading ? <p className="text-sm text-muted-foreground">{tc("states.loading")}</p> : null}
      {!loading && loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
      {!loading && !loadError && agents.length === 0 ? (
        <EmptyState
          icon={<Bot className="size-5" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          actions={<Button onClick={openCreate}>{t("create")}</Button>}
        />
      ) : null}
      {!loading && agents.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.name")}</TableHead>
              <TableHead>{t("columns.slug")}</TableHead>
              <TableHead>{t("columns.runtime")}</TableHead>
              <TableHead>{t("columns.model")}</TableHead>
              <TableHead>{t("columns.capabilities")}</TableHead>
              <TableHead>{t("columns.visibility")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead>{t("columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.map((agent) => (
              <TableRow key={agent.id}>
                <TableCell className="font-medium">{agent.displayName}</TableCell>
                <TableCell className="text-muted-foreground">{agent.slug}</TableCell>
                <TableCell>{t(`runtime.${isRuntime(agent.runtime) ? agent.runtime : "cloud"}`)}</TableCell>
                <TableCell className="max-w-[220px] truncate" title={agent.model}>
                  {agent.model}
                </TableCell>
                <TableCell>{agent.capabilityIds.length}</TableCell>
                <TableCell>
                  {agent.assignmentKeys.includes("all")
                    ? t("visibility.all")
                    : t("visibility.count", { count: agent.assignmentKeys.length })}
                </TableCell>
                <TableCell>
                  <Badge variant={agent.status === "disabled" ? "secondary" : "default"}>
                    {isStatus(agent.status) && agent.status === "disabled" ? t("status.disabled") : t("status.active")}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(agent)}>
                      {t("actions.edit")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDeleteError("");
                        setPendingDelete(agent);
                      }}
                    >
                      {t("actions.delete")}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (saving) return;
          if (!open) setEditor(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editor?.mode === "edit" ? t("form.editTitle") : t("form.createTitle")}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] pr-4">
            <div className="space-y-4">
              {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="agent-name">{t("form.name")}</Label>
                  <Input
                    id="agent-name"
                    maxLength={64}
                    value={form.displayName}
                    onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="agent-slug">{t("form.slug")}</Label>
                  <Input
                    id="agent-slug"
                    maxLength={63}
                    value={form.slug}
                    readOnly={editor?.mode === "edit"}
                    className={editor?.mode === "edit" ? "bg-muted" : undefined}
                    placeholder="report-bot"
                    onChange={(event) => setForm({ ...form, slug: event.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">{t("form.slugHint")}</p>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="agent-description">{t("form.description")}</Label>
                <Textarea
                  id="agent-description"
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>{t("form.model")}</Label>
                  <Select value={form.model || undefined} onValueChange={(model) => setForm({ ...form, model })}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("form.modelPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {modelChoices.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {modelChoices.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t("form.modelEmpty")}</p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <Label>{t("form.runtime")}</Label>
                  <Select
                    value={form.runtime}
                    onValueChange={(runtime) => {
                      if (isRuntime(runtime)) setForm({ ...form, runtime });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cloud">{t("runtime.cloud")}</SelectItem>
                      <SelectItem value="desktop_worker">{t("runtime.desktop_worker")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="agent-prompt">{t("form.systemPrompt")}</Label>
                <Textarea
                  id="agent-prompt"
                  rows={6}
                  maxLength={16000}
                  value={form.systemPrompt}
                  onChange={(event) => setForm({ ...form, systemPrompt: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="agent-knowledge">{t("form.knowledgeSearchUrl")}</Label>
                <Input
                  id="agent-knowledge"
                  value={form.knowledgeSearchUrl}
                  placeholder="https://"
                  onChange={(event) => setForm({ ...form, knowledgeSearchUrl: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">{t("form.capabilities")}</div>
                <p className="text-xs text-muted-foreground">{t("form.capabilitiesHint")}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <CapabilityList
                    title={t("form.mcp")}
                    items={mcpServers}
                    selected={form.capabilityIds}
                    emptyLabel={t("form.noMcp")}
                    disabledLabel={t("status.disabled")}
                    onToggle={(id) => setForm((prev) => ({ ...prev, capabilityIds: toggleId(prev.capabilityIds, id) }))}
                  />
                  <CapabilityList
                    title={t("form.skill")}
                    items={skills}
                    selected={form.capabilityIds}
                    emptyLabel={t("form.noSkill")}
                    disabledLabel={t("status.disabled")}
                    onToggle={(id) => setForm((prev) => ({ ...prev, capabilityIds: toggleId(prev.capabilityIds, id) }))}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">{t("form.visibility")}</div>
                <AssignmentScopeEditor
                  value={form.assignment}
                  onChange={(assignment) => setForm({ ...form, assignment })}
                  depts={directory.depts}
                  groups={directory.groups}
                  users={directory.users}
                />
              </div>
              {form.runtime === "desktop_worker" ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium">{t("form.workers")}</div>
                  <AssignmentScopeEditor
                    value={form.workerAssignment}
                    onChange={(workerAssignment) => setForm({ ...form, workerAssignment })}
                    depts={directory.depts}
                    groups={directory.groups}
                    users={directory.users}
                  />
                </div>
              ) : null}
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(checked) => setForm({ ...form, enabled: Boolean(checked) })}
                />
                <span>{t("form.enabled")}</span>
              </label>
            </div>
          </ScrollArea>
          <DialogFooter className="flex-row justify-end">
            <Button variant="outline" onClick={() => !saving && setEditor(null)}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {tc("actions.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (deleting) return;
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("delete.title")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("delete.description", { name: pendingDelete?.displayName ?? "" })}
          </p>
          {deleteError ? <p className="text-sm text-destructive">{deleteError}</p> : null}
          <DialogFooter className="flex-row justify-end">
            <Button variant="outline" onClick={() => !deleting && setPendingDelete(null)}>
              {tc("actions.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={deleting}>
              {t("delete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CapabilityList({
  title,
  items,
  selected,
  emptyLabel,
  disabledLabel,
  onToggle,
}: {
  title: string;
  items: CapabilityOption[];
  selected: string[];
  emptyLabel: string;
  disabledLabel: string;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      {items.length === 0 ? <p className="text-xs text-muted-foreground">{emptyLabel}</p> : null}
      {items.map((item) => (
        <label key={item.id} className="flex items-center gap-2 text-sm">
          <Checkbox checked={selected.includes(item.id)} onCheckedChange={() => onToggle(item.id)} />
          <span className="truncate">{item.label}</span>
          <span className="truncate text-xs text-muted-foreground">{item.detail}</span>
          {item.disabled ? <Badge variant="secondary">{disabledLabel}</Badge> : null}
        </label>
      ))}
    </div>
  );
}
