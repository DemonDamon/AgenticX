"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "@agenticx/ui";
import { CalendarClock } from "lucide-react";
import { useTranslations } from "next-intl";

import { adminFetch } from "../../../lib/admin-client-auth";
import { MaCronValidationError, parseCron, validateTimezone } from "../../../../../../packages/iam-core/src/repos/ma-cron";

type VersionPolicy = "follow_routing" | "pinned";
type RunStatus = "scheduled" | "firing" | "running" | "succeeded" | "failed" | "skipped";
type SkipReason = "missed" | "overlap" | "revised" | "disabled" | "deleted";
type Trigger = "schedule" | "manual";

type ScheduleRow = {
  id: string;
  name: string;
  description: string | null;
  agent_id: string;
  version_policy: VersionPolicy;
  pinned_version: number | null;
  environment_id: string | null;
  cron: string;
  timezone: string;
  input_template: string;
  enabled: boolean;
  next_run_at: string | null;
  last_run: { id: string; status: string; scheduled_for: string; session_id: string | null } | null;
};

type RunRow = {
  id: string;
  trigger: Trigger;
  scheduled_for: string;
  status: RunStatus;
  skip_reason: SkipReason | null;
  session_id: string | null;
  error: string | null;
};

type AgentOption = { id: string; displayName?: string; slug?: string };
type EnvOption = { id: string; name: string; status?: string };

type Editor = {
  id: string | null;
  name: string;
  description: string;
  agentId: string;
  versionPolicy: VersionPolicy;
  pinnedVersion: string;
  environmentId: string;
  cron: string;
  timezone: string;
  inputTemplate: string;
};

const EMPTY_EDITOR: Editor = {
  id: null,
  name: "",
  description: "",
  agentId: "",
  versionPolicy: "follow_routing",
  pinnedVersion: "",
  environmentId: "",
  cron: "0 9 * * 1-5",
  timezone: "Asia/Shanghai",
  inputTemplate: "",
};

function isPolicy(value: string): value is VersionPolicy {
  return value === "follow_routing" || value === "pinned";
}

function isRunStatus(value: string): value is RunStatus {
  return value === "scheduled" || value === "firing" || value === "running" || value === "succeeded" || value === "failed" || value === "skipped";
}

function isSkip(value: string | null): value is SkipReason {
  return value === "missed" || value === "overlap" || value === "revised" || value === "disabled" || value === "deleted";
}

function isTrigger(value: string): value is Trigger {
  return value === "schedule" || value === "manual";
}

function cronError(expr: string): string {
  try {
    parseCron(expr);
    return "";
  } catch (error) {
    return error instanceof MaCronValidationError ? error.message : "cron: expected 5 fields";
  }
}

function timezoneError(value: string): string {
  try {
    validateTimezone(value);
    return "";
  } catch (error) {
    return error instanceof MaCronValidationError ? error.message : "timezone: unknown time zone";
  }
}

async function readEnvelope(response: Response): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
  const body = (await response.json().catch(() => null)) as { code?: string; message?: string; data?: unknown } | null;
  if (!response.ok || !body || body.code !== "00000") {
    return { ok: false, message: body?.message || `HTTP ${response.status}` };
  }
  return { ok: true, data: body.data };
}

export default function AgentSchedulesSection() {
  const t = useTranslations("pages.admin.agentSchedules");
  const tc = useTranslations("common");
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [environments, setEnvironments] = useState<EnvOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorError, setEditorError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ScheduleRow | null>(null);
  const [history, setHistory] = useState<{ schedule: ScheduleRow; runs: RunRow[] } | null>(null);

  const agentName = useMemo(() => {
    const names = new Map(agents.map((agent) => [agent.id, agent.displayName || agent.slug || agent.id]));
    return (id: string) => names.get(id) || id;
  }, [agents]);

  const load = useCallback(async () => {
    setLoading(true);
    const [scheduleRes, agentRes, envRes] = await Promise.all([
      adminFetch("/api/admin/ma-schedules", { cache: "no-store" }),
      adminFetch("/api/admin/agents", { cache: "no-store" }),
      adminFetch("/api/admin/ma-environments", { cache: "no-store" }),
    ]);
    const scheduleBody = await readEnvelope(scheduleRes);
    if (scheduleBody.ok && scheduleBody.data && typeof scheduleBody.data === "object") {
      const data = scheduleBody.data as { schedules?: ScheduleRow[] };
      setRows(Array.isArray(data.schedules) ? data.schedules : []);
    }
    const agentBody = await readEnvelope(agentRes);
    if (agentBody.ok && agentBody.data && typeof agentBody.data === "object") {
      const data = agentBody.data as { agents?: AgentOption[] };
      setAgents(Array.isArray(data.agents) ? data.agents : []);
    }
    const envBody = await readEnvelope(envRes);
    if (envBody.ok && envBody.data && typeof envBody.data === "object") {
      const data = envBody.data as { environments?: EnvOption[] };
      setEnvironments(Array.isArray(data.environments) ? data.environments.filter((item) => item.status !== "disabled") : []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function statusLabel(status: string): string {
    if (!isRunStatus(status)) return status;
    switch (status) {
      case "scheduled":
        return t("runStatus.scheduled");
      case "firing":
        return t("runStatus.firing");
      case "running":
        return t("runStatus.running");
      case "succeeded":
        return t("runStatus.succeeded");
      case "failed":
        return t("runStatus.failed");
      case "skipped":
        return t("runStatus.skipped");
      default: {
        const unreachable: never = status;
        return unreachable;
      }
    }
  }

  function skipLabel(reason: string | null): string {
    if (!isSkip(reason)) return "";
    switch (reason) {
      case "missed":
        return t("skip.missed");
      case "overlap":
        return t("skip.overlap");
      case "revised":
        return t("skip.revised");
      case "disabled":
        return t("skip.disabled");
      case "deleted":
        return t("skip.deleted");
      default: {
        const unreachable: never = reason;
        return unreachable;
      }
    }
  }

  function triggerLabel(trigger: string): string {
    if (!isTrigger(trigger)) return trigger;
    switch (trigger) {
      case "schedule":
        return t("trigger.schedule");
      case "manual":
        return t("trigger.manual");
      default: {
        const unreachable: never = trigger;
        return unreachable;
      }
    }
  }

  async function toggle(row: ScheduleRow, enabled: boolean) {
    const response = await adminFetch(`/api/admin/ma-schedules/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const body = await readEnvelope(response);
    if (!body.ok) return;
    await load();
  }

  async function save() {
    if (!editor) return;
    setSaving(true);
    setEditorError("");
    const payload: Record<string, unknown> = {
      name: editor.name,
      description: editor.description || null,
      agent_id: editor.agentId,
      version_policy: editor.versionPolicy,
      pinned_version: editor.versionPolicy === "pinned" ? Number(editor.pinnedVersion) : null,
      environment_id: editor.environmentId || null,
      cron: editor.cron,
      timezone: editor.timezone || "Asia/Shanghai",
      input_template: editor.inputTemplate,
    };
    const response = await adminFetch(editor.id ? `/api/admin/ma-schedules/${editor.id}` : "/api/admin/ma-schedules", {
      method: editor.id ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await readEnvelope(response);
    setSaving(false);
    if (!body.ok) {
      setEditorError(body.message);
      return;
    }
    setEditor(null);
    await load();
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setSaving(true);
    const response = await adminFetch(`/api/admin/ma-schedules/${pendingDelete.id}`, { method: "DELETE" });
    const body = await readEnvelope(response);
    setSaving(false);
    if (!body.ok) {
      setEditorError(body.message);
      return;
    }
    setPendingDelete(null);
    await load();
  }

  async function runNow(row: ScheduleRow) {
    await adminFetch(`/api/admin/ma-schedules/${row.id}/run`, { method: "POST" });
    await load();
  }

  async function openHistory(row: ScheduleRow) {
    const response = await adminFetch(`/api/admin/ma-schedules/${row.id}/runs?limit=50`, { cache: "no-store" });
    const body = await readEnvelope(response);
    const runs = body.ok && body.data && typeof body.data === "object" ? (body.data as { runs?: RunRow[] }).runs : [];
    setHistory({ schedule: row, runs: Array.isArray(runs) ? runs : [] });
  }

  const liveCronError = editor ? cronError(editor.cron) : "";
  const liveZoneError = editor ? timezoneError(editor.timezone || "Asia/Shanghai") : "";

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={<Button onClick={() => { setEditorError(""); setEditor(EMPTY_EDITOR); }}>{t("create")}</Button>}
      />
      {loading ? <p className="text-sm text-muted-foreground">{tc("states.loading")}</p> : null}
      {!loading && rows.length === 0 ? (
        <EmptyState icon={<CalendarClock className="size-5" />} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : null}
      {rows.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.name")}</TableHead>
              <TableHead>{t("columns.agent")}</TableHead>
              <TableHead>{t("columns.plan")}</TableHead>
              <TableHead>{t("columns.enabled")}</TableHead>
              <TableHead>{t("columns.next")}</TableHead>
              <TableHead>{t("columns.last")}</TableHead>
              <TableHead>{t("columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.name}</TableCell>
                <TableCell>{agentName(row.agent_id)}</TableCell>
                <TableCell>
                  <div>{row.cron}</div>
                  <div className="text-xs text-muted-foreground">{row.timezone}</div>
                </TableCell>
                <TableCell>
                  <Switch checked={row.enabled} onCheckedChange={(checked) => void toggle(row, checked === true)} />
                </TableCell>
                <TableCell>{row.next_run_at ? new Date(row.next_run_at).toLocaleString() : t("pending")}</TableCell>
                <TableCell>
                  {row.last_run ? (
                    <span>
                      {statusLabel(row.last_run.status)} · {new Date(row.last_run.scheduled_for).toLocaleString()}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditorError("");
                      setEditor({
                        id: row.id,
                        name: row.name,
                        description: row.description ?? "",
                        agentId: row.agent_id,
                        versionPolicy: row.version_policy,
                        pinnedVersion: row.pinned_version == null ? "" : String(row.pinned_version),
                        environmentId: row.environment_id ?? "",
                        cron: row.cron,
                        timezone: row.timezone,
                        inputTemplate: row.input_template,
                      });
                    }}
                  >
                    {t("actions.edit")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void runNow(row)}>
                    {t("actions.run")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void openHistory(row)}>
                    {t("actions.history")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPendingDelete(row)}>
                    {t("actions.delete")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      <Dialog open={editor !== null} onOpenChange={(open) => !saving && !open && setEditor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editor?.id ? t("actions.edit") : t("create")}</DialogTitle>
          </DialogHeader>
          {editor ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>{t("fields.name")}</Label>
                <Input value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>{t("fields.description")}</Label>
                <Input value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>{t("fields.agent")}</Label>
                <Select value={editor.agentId} onValueChange={(agentId) => setEditor({ ...editor, agentId })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>{agent.displayName || agent.slug || agent.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("fields.policy")}</Label>
                <Select
                  value={editor.versionPolicy}
                  onValueChange={(value) => {
                    if (!isPolicy(value)) return;
                    setEditor({ ...editor, versionPolicy: value });
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="follow_routing">{t("policy.follow")}</SelectItem>
                    <SelectItem value="pinned">{t("policy.pinned")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {editor.versionPolicy === "pinned" ? (
                <div className="space-y-1">
                  <Label>{t("fields.version")}</Label>
                  <Input value={editor.pinnedVersion} onChange={(event) => setEditor({ ...editor, pinnedVersion: event.target.value })} />
                </div>
              ) : null}
              <div className="space-y-1">
                <Label>{t("fields.environment")}</Label>
                <Select
                  value={editor.environmentId || "__default__"}
                  onValueChange={(value) => setEditor({ ...editor, environmentId: value === "__default__" ? "" : value })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">{t("fields.environmentDefault")}</SelectItem>
                    {environments.map((environment) => (
                      <SelectItem key={environment.id} value={environment.id}>{environment.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("fields.cron")}</Label>
                <div className="flex items-center gap-3">
                  <Input value={editor.cron} onChange={(event) => setEditor({ ...editor, cron: event.target.value })} />
                  {liveCronError ? <span className="text-sm text-destructive">{liveCronError}</span> : null}
                </div>
              </div>
              <div className="space-y-1">
                <Label>{t("fields.timezone")}</Label>
                <Input value={editor.timezone} onChange={(event) => setEditor({ ...editor, timezone: event.target.value })} />
                {liveZoneError ? <p className="text-sm text-destructive">{liveZoneError}</p> : null}
              </div>
              <div className="space-y-1">
                <Label>{t("fields.input")}</Label>
                <Textarea value={editor.inputTemplate} onChange={(event) => setEditor({ ...editor, inputTemplate: event.target.value })} />
                <p className="text-xs text-muted-foreground">{t("fields.inputHint")}</p>
              </div>
              {editorError ? <p className="text-sm text-destructive">{editorError}</p> : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setEditor(null)}>{tc("actions.cancel")}</Button>
            <Button disabled={saving || Boolean(liveCronError || liveZoneError)} onClick={() => void save()}>{tc("actions.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !saving && !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("delete.title")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("delete.description")}</p>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setPendingDelete(null)}>{tc("actions.cancel")}</Button>
            <Button variant="destructive" disabled={saving} onClick={() => void confirmDelete()}>{tc("actions.delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={history !== null} onOpenChange={(open) => !open && setHistory(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>{t("historyTitle")}</SheetTitle>
          </SheetHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("historyColumns.when")}</TableHead>
                <TableHead>{t("historyColumns.trigger")}</TableHead>
                <TableHead>{t("historyColumns.status")}</TableHead>
                <TableHead>{t("historyColumns.session")}</TableHead>
                <TableHead>{t("historyColumns.error")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(history?.runs ?? []).map((run) => (
                <TableRow key={run.id}>
                  <TableCell>{new Date(run.scheduled_for).toLocaleString()}</TableCell>
                  <TableCell>{triggerLabel(run.trigger)}</TableCell>
                  <TableCell>
                    {statusLabel(run.status)}
                    {run.skip_reason ? ` · ${skipLabel(run.skip_reason)}` : ""}
                  </TableCell>
                  <TableCell>
                    {run.session_id ? <Link href={`/ops/logs/managed/${run.session_id}`}>{run.session_id}</Link> : "—"}
                  </TableCell>
                  <TableCell>{run.error || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SheetContent>
      </Sheet>
    </div>
  );
}
