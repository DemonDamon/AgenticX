"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from "@agenticx/ui";
import { Server } from "lucide-react";
import { useTranslations } from "next-intl";

import { AssignmentScopeEditor } from "../../../components/assignment/AssignmentScopeEditor";
import { useAssignmentDirectory } from "../../../components/assignment/useAssignmentDirectory";
import { adminFetch } from "../../../lib/admin-client-auth";
import { fromAssignmentKeys, toAssignmentKeys, type AssignmentDraft } from "../../../lib/capability-pack-form";

type EnvType = "cloud" | "desktop_worker";
type EnvStatus = "active" | "disabled";
type SandboxBackend = "docker" | "remote" | "subprocess";

type EnvRow = {
  id: string;
  name: string;
  description: string | null;
  type: EnvType;
  config: Record<string, unknown>;
  status: EnvStatus;
  references: { agents: number; activeSessions: number; openWorkItems: number };
};

type EnvForm = {
  name: string;
  description: string;
  type: EnvType;
  sandboxBackend: SandboxBackend;
  image: string;
  egress: string;
  idleTtl: string;
  workers: AssignmentDraft;
};

const EMPTY_WORKERS: AssignmentDraft = { allMembers: false, deptIds: [], groupIds: [], userIds: [] };

const EMPTY_FORM: EnvForm = {
  name: "",
  description: "",
  type: "cloud",
  sandboxBackend: "docker",
  image: "",
  egress: "",
  idleTtl: "3600",
  workers: EMPTY_WORKERS,
};

function isEnvType(value: string): value is EnvType {
  return value === "cloud" || value === "desktop_worker";
}

function isSandbox(value: string): value is SandboxBackend {
  return value === "docker" || value === "remote" || value === "subprocess";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formFromEnv(env: EnvRow): EnvForm {
  const config = isRecord(env.config) ? env.config : {};
  const workerKeys = Array.isArray(config.worker_keys) ? config.worker_keys.map(String) : [];
  const domains = Array.isArray(config.egress_allow_domains) ? config.egress_allow_domains.map(String) : [];
  const sandbox = typeof config.sandbox_backend === "string" && isSandbox(config.sandbox_backend) ? config.sandbox_backend : "docker";
  return {
    name: env.name,
    description: env.description ?? "",
    type: env.type,
    sandboxBackend: sandbox,
    image: typeof config.image === "string" ? config.image : "",
    egress: domains.join("\n"),
    idleTtl: typeof config.idle_ttl_seconds === "number" ? String(config.idle_ttl_seconds) : "3600",
    workers: fromAssignmentKeys(workerKeys),
  };
}

function configFromForm(form: EnvForm): Record<string, unknown> {
  switch (form.type) {
    case "cloud":
      return {
        type: "cloud",
        sandbox_backend: form.sandboxBackend,
        image: form.image.trim() || null,
        egress_allow_domains: form.egress
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
        idle_ttl_seconds: Number(form.idleTtl),
      };
    case "desktop_worker":
      return { type: "desktop_worker", worker_keys: toAssignmentKeys(form.workers) };
    default: {
      const unreachable: never = form.type;
      return unreachable;
    }
  }
}

export default function AgentEnvironmentsSection() {
  const t = useTranslations("pages.admin.agentEnvironments");
  const tc = useTranslations("common");
  const directory = useAssignmentDirectory();
  const [rows, setRows] = useState<EnvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; id?: string } | null>(null);
  const [form, setForm] = useState<EnvForm>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDisable, setPendingDisable] = useState<EnvRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EnvRow | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/ma-environments", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { message?: string; data?: { environments?: EnvRow[] } };
      if (!res.ok) throw new Error(json.message || tc("toast.loadFailed"));
      setRows(json.data?.environments ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [tc]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError("");
    setEditor({ mode: "create" });
  }

  function openEdit(row: EnvRow) {
    setForm(formFromEnv(row));
    setFormError("");
    setEditor({ mode: "edit", id: row.id });
  }

  async function save() {
    if (!editor || saving) return;
    setSaving(true);
    setFormError("");
    const payload = {
      name: form.name,
      description: form.description,
      config: configFromForm(form),
      ...(editor.mode === "create" ? { type: form.type, status: "active" as const } : {}),
    };
    try {
      const res = await adminFetch(
        editor.mode === "create" ? "/api/admin/ma-environments" : `/api/admin/ma-environments/${editor.id}`,
        {
          method: editor.mode === "create" ? "POST" : "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
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

  async function setStatus(row: EnvRow, status: EnvStatus) {
    setBusy(true);
    try {
      const res = await adminFetch(`/api/admin/ma-environments/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        toast.error(json.message || tc("toast.saveFailed"));
        return;
      }
      toast.success(status === "disabled" ? t("toast.disabled") : t("toast.enabled"));
      setPendingDisable(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("toast.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || busy) return;
    setBusy(true);
    setDeleteError("");
    try {
      const res = await adminFetch(`/api/admin/ma-environments/${pendingDelete.id}`, { method: "DELETE" });
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
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t("title")} description={t("description")} actions={<Button onClick={openCreate}>{t("create")}</Button>} />
      {loading ? <p className="text-sm text-muted-foreground">{tc("states.loading")}</p> : null}
      {!loading && rows.length === 0 ? (
        <EmptyState
          icon={<Server className="size-5" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          actions={<Button onClick={openCreate}>{t("create")}</Button>}
        />
      ) : null}
      {!loading && rows.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.name")}</TableHead>
              <TableHead>{t("columns.type")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead>{t("columns.references")}</TableHead>
              <TableHead>{t("columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell>{t(`type.${row.type}`)}</TableCell>
                <TableCell>{t(`status.${row.status}`)}</TableCell>
                <TableCell>
                  {t("references", {
                    agents: row.references?.agents ?? 0,
                    sessions: row.references?.activeSessions ?? 0,
                  })}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(row)}>
                      {t("actions.edit")}
                    </Button>
                    {row.status === "active" ? (
                      <Button size="sm" variant="outline" onClick={() => setPendingDisable(row)}>
                        {t("actions.disable")}
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => void setStatus(row, "active")}>
                        {t("actions.enable")}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDeleteError("");
                        setPendingDelete(row);
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

      <Dialog open={editor !== null} onOpenChange={(open) => !saving && !open && setEditor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editor?.mode === "edit" ? t("form.editTitle") : t("form.createTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
            <div className="space-y-1">
              <Label>{t("form.name")}</Label>
              <Input maxLength={64} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{t("form.description")}</Label>
              <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{t("form.type")}</Label>
              <Select
                value={form.type}
                disabled={editor?.mode === "edit"}
                onValueChange={(value) => {
                  if (isEnvType(value)) setForm({ ...form, type: value });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cloud">{t("type.cloud")}</SelectItem>
                  <SelectItem value="desktop_worker">{t("type.desktop_worker")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.type === "cloud" ? (
              <>
                <div className="space-y-1">
                  <Label>{t("form.sandboxBackend")}</Label>
                  <Select
                    value={form.sandboxBackend}
                    onValueChange={(value) => {
                      if (isSandbox(value)) setForm({ ...form, sandboxBackend: value });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="docker">{t("form.sandbox.docker")}</SelectItem>
                      <SelectItem value="remote">{t("form.sandbox.remote")}</SelectItem>
                      <SelectItem value="subprocess">{t("form.sandbox.subprocess")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>{t("form.image")}</Label>
                  <Input value={form.image} onChange={(event) => setForm({ ...form, image: event.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>{t("form.egress")}</Label>
                  <Textarea rows={4} value={form.egress} onChange={(event) => setForm({ ...form, egress: event.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>{t("form.idleTtl")}</Label>
                  <Input inputMode="numeric" value={form.idleTtl} onChange={(event) => setForm({ ...form, idleTtl: event.target.value })} />
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <div className="text-sm font-medium">{t("form.workers")}</div>
                <AssignmentScopeEditor
                  value={form.workers}
                  onChange={(workers) => setForm({ ...form, workers })}
                  depts={directory.depts}
                  groups={directory.groups}
                  users={directory.users}
                />
              </div>
            )}
          </div>
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

      <Dialog open={pendingDisable !== null} onOpenChange={(open) => !busy && !open && setPendingDisable(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("disable.title")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("disable.description", { name: pendingDisable?.name ?? "" })}</p>
          <DialogFooter className="flex-row justify-end">
            <Button variant="outline" onClick={() => !busy && setPendingDisable(null)}>
              {tc("actions.cancel")}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => pendingDisable && void setStatus(pendingDisable, "disabled")}>
              {t("disable.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (busy) return;
          if (!open) {
            setPendingDelete(null);
            setDeleteError("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("delete.title")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("delete.description", { name: pendingDelete?.name ?? "" })}</p>
          {deleteError ? <p className="text-sm text-destructive">{deleteError}</p> : null}
          <DialogFooter className="flex-row justify-end">
            <Button variant="outline" onClick={() => !busy && setPendingDelete(null)}>
              {tc("actions.cancel")}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void confirmDelete()}>
              {t("delete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
