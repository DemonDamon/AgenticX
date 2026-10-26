"use client";

import { useCallback, useEffect, useState } from "react";
import type { MaWebhookEventGroupKey, MaWebhookEventType } from "@agenticx/core-api";
import {
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
import { ChevronDown, ChevronRight, Webhook } from "lucide-react";
import { useTranslations } from "next-intl";

import { adminFetch } from "../../../lib/admin-client-auth";

// The catalog value lives in @agenticx/core-api, but that module imports node:crypto.
// A value import breaks the client bundle, so this copy is checked against
// MA_WEBHOOK_EVENT_GROUPS in agent-webhook-messages.test.ts.
export const WEBHOOK_EVENT_GROUPS = [
  { key: "session", types: ["session.status_run_started", "session.status_idled", "session.idle", "session.failed"] },
  { key: "thread", types: ["session.thread_created", "session.thread_idled", "session.thread_terminated"] },
  { key: "agent", types: ["agent.created", "agent.version_published", "agent.deleted"] },
  { key: "environment", types: ["environment.created", "environment.updated", "environment.deleted"] },
  {
    key: "vault",
    types: [
      "vault.created",
      "vault.archived",
      "vault.deleted",
      "vault_credential.created",
      "vault_credential.archived",
      "vault_credential.deleted",
      "credential.expiring",
    ],
  },
  { key: "memory_store", types: ["memory_store.created", "memory_store.archived", "memory_store.deleted"] },
  { key: "schedule", types: ["schedule.created", "schedule.updated", "schedule.deleted"] },
  { key: "schedule_run", types: ["schedule_run.started", "schedule_run.succeeded", "schedule_run.failed"] },
] as const satisfies readonly { key: MaWebhookEventGroupKey; types: readonly MaWebhookEventType[] }[];

export const WEBHOOK_EVENT_TYPES: readonly MaWebhookEventType[] = WEBHOOK_EVENT_GROUPS.flatMap((group) => group.types);

const SOURCES = ["portal", "desktop", "api", "schedule", "channel", "eval"] as const;
const NAME_MAX = 120;
const DESCRIPTION_MAX = 2048;
const DISABLED_REASONS = ["consecutive_failures", "gone"] as const;

type Source = (typeof SOURCES)[number];
type DisabledReason = (typeof DISABLED_REASONS)[number];

type WebhookRow = {
  id: string;
  name: string;
  description?: string;
  url: string;
  event_types: string[];
  agent_ids: string[];
  sources: string[];
  include_result_text: boolean;
  enabled: boolean;
  disabled_reason?: string | null;
  updated_at: string;
};

type DeliveryRow = {
  id: string;
  event_type: string;
  status: string;
  attempts: number;
  last_status_code: number | null;
  last_error: string | null;
  created_at: string;
};

type AgentOption = { id: string; displayName?: string; slug?: string };

type Editor = {
  id: string | null;
  name: string;
  url: string;
  description: string;
  eventTypes: MaWebhookEventType[];
  agentIds: string[];
  sources: Source[];
  includeResultText: boolean;
};

const EMPTY_EDITOR: Editor = {
  id: null,
  name: "",
  url: "",
  description: "",
  eventTypes: [],
  agentIds: [],
  sources: [],
  includeResultText: false,
};

function isEventType(value: string): value is MaWebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

function isSource(value: string): value is Source {
  return (SOURCES as readonly string[]).includes(value);
}

function isDisabledReason(value: string): value is DisabledReason {
  return (DISABLED_REASONS as readonly string[]).includes(value);
}

function checkedState(selected: number, total: number): boolean | "indeterminate" {
  if (selected <= 0) return false;
  if (selected >= total) return true;
  return "indeterminate";
}

function applyGroupSelection(
  current: readonly MaWebhookEventType[],
  groupTypes: readonly string[],
  selectAll: boolean,
): MaWebhookEventType[] {
  const next = new Set<string>(current);
  if (selectAll) {
    for (const type of groupTypes) next.add(type);
  } else {
    for (const type of groupTypes) next.delete(type);
  }
  return WEBHOOK_EVENT_TYPES.filter((type) => next.has(type));
}

function toggleEvent(current: readonly MaWebhookEventType[], eventType: MaWebhookEventType): MaWebhookEventType[] {
  const next = new Set<string>(current);
  if (next.has(eventType)) next.delete(eventType);
  else next.add(eventType);
  return WEBHOOK_EVENT_TYPES.filter((type) => next.has(type));
}

async function readEnvelope(response: Response): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
  const body = (await response.json().catch(() => null)) as { code?: string; message?: string; data?: unknown } | null;
  if (!response.ok || !body || body.code !== "00000") {
    return { ok: false, message: body?.message || `HTTP ${response.status}` };
  }
  return { ok: true, data: body.data };
}

function toggleValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export default function AgentWebhooksSection() {
  const t = useTranslations("pages.admin.agentWebhooks");
  const tc = useTranslations("common");
  const [rows, setRows] = useState<WebhookRow[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorError, setEditorError] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WebhookRow | null>(null);
  const [history, setHistory] = useState<{ webhook: WebhookRow; deliveries: DeliveryRow[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [webhookRes, agentRes] = await Promise.all([
      adminFetch("/api/admin/ma-webhooks", { cache: "no-store" }),
      adminFetch("/api/admin/agents", { cache: "no-store" }),
    ]);
    const webhookBody = await readEnvelope(webhookRes);
    if (webhookBody.ok && webhookBody.data && typeof webhookBody.data === "object") {
      const data = webhookBody.data as { webhooks?: WebhookRow[] };
      setRows(Array.isArray(data.webhooks) ? data.webhooks : []);
    }
    const agentBody = await readEnvelope(agentRes);
    if (agentBody.ok && agentBody.data && typeof agentBody.data === "object") {
      const data = agentBody.data as { agents?: AgentOption[] };
      setAgents(Array.isArray(data.agents) ? data.agents : []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function eventLabel(value: string): string {
    if (!isEventType(value)) return value;
    return t(`events.${value.replaceAll(".", "_")}`);
  }

  function eventGroupLabel(key: MaWebhookEventGroupKey): string {
    switch (key) {
      case "session":
        return t("eventGroups.session");
      case "thread":
        return t("eventGroups.thread");
      case "agent":
        return t("eventGroups.agent");
      case "environment":
        return t("eventGroups.environment");
      case "vault":
        return t("eventGroups.vault");
      case "memory_store":
        return t("eventGroups.memory_store");
      case "schedule":
        return t("eventGroups.schedule");
      case "schedule_run":
        return t("eventGroups.schedule_run");
      default: {
        const unreachable: never = key;
        return unreachable;
      }
    }
  }

  function disabledReasonLabel(reason: string): string {
    if (!isDisabledReason(reason)) return reason;
    switch (reason) {
      case "consecutive_failures":
        return t("disabledReason.consecutive_failures");
      case "gone":
        return t("disabledReason.gone");
      default: {
        const unreachable: never = reason;
        return unreachable;
      }
    }
  }

  function sourceLabel(value: string): string {
    if (!isSource(value)) return value;
    switch (value) {
      case "portal":
        return t("sources.portal");
      case "desktop":
        return t("sources.desktop");
      case "api":
        return t("sources.api");
      case "schedule":
        return t("sources.schedule");
      case "channel":
        return t("sources.channel");
      case "eval":
        return t("sources.eval");
      default: {
        const unreachable: never = value;
        return unreachable;
      }
    }
  }

  function openCreate() {
    setEditorError("");
    setAdvancedOpen(false);
    setEditor(EMPTY_EDITOR);
  }

  function openEdit(row: WebhookRow) {
    setEditorError("");
    setAdvancedOpen(false);
    setEditor({
      id: row.id,
      name: row.name,
      url: row.url,
      description: row.description ?? "",
      eventTypes: WEBHOOK_EVENT_TYPES.filter((type) => row.event_types.includes(type)),
      agentIds: row.agent_ids,
      sources: row.sources.filter(isSource),
      includeResultText: row.include_result_text,
    });
  }

  function setEventTypes(next: MaWebhookEventType[]) {
    setEditor((current) => (current ? { ...current, eventTypes: next } : current));
    if (next.length > 0) {
      setEditorError((current) => (current === t("eventsRequired") ? "" : current));
    }
  }

  async function toggle(row: WebhookRow, enabled: boolean) {
    const response = await adminFetch(`/api/admin/ma-webhooks/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const body = await readEnvelope(response);
    if (body.ok) await load();
  }

  async function save() {
    if (!editor) return;
    if (editor.eventTypes.length === 0) {
      setEditorError(t("eventsRequired"));
      return;
    }
    setSaving(true);
    setEditorError("");
    const payload = {
      name: editor.name,
      description: editor.description,
      url: editor.url,
      event_types: editor.eventTypes,
      agent_ids: editor.agentIds,
      sources: editor.sources,
      include_result_text: editor.includeResultText,
    };
    const response = await adminFetch(editor.id ? `/api/admin/ma-webhooks/${editor.id}` : "/api/admin/ma-webhooks", {
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
    const data = body.data as { signing_secret?: string } | null;
    setEditor(null);
    if (data && typeof data.signing_secret === "string") setSecret(data.signing_secret);
    await load();
  }

  async function rotate(row: WebhookRow) {
    const response = await adminFetch(`/api/admin/ma-webhooks/${row.id}/rotate-secret`, { method: "POST" });
    const body = await readEnvelope(response);
    if (!body.ok) return;
    const data = body.data as { signing_secret?: string };
    if (typeof data.signing_secret === "string") setSecret(data.signing_secret);
    await load();
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setSaving(true);
    const response = await adminFetch(`/api/admin/ma-webhooks/${pendingDelete.id}`, { method: "DELETE" });
    const body = await readEnvelope(response);
    setSaving(false);
    if (!body.ok) return;
    setPendingDelete(null);
    await load();
  }

  async function openHistory(row: WebhookRow) {
    const response = await adminFetch(`/api/admin/ma-webhooks/${row.id}/deliveries?limit=50`, { cache: "no-store" });
    const body = await readEnvelope(response);
    const deliveries =
      body.ok && body.data && typeof body.data === "object" ? (body.data as { deliveries?: DeliveryRow[] }).deliveries : [];
    setHistory({ webhook: row, deliveries: Array.isArray(deliveries) ? deliveries : [] });
  }

  const selectedCount = editor?.eventTypes.length ?? 0;
  const selectedEvents = new Set<string>(editor?.eventTypes ?? []);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={<Button onClick={openCreate}>{t("create")}</Button>}
      />
      {loading ? <p className="text-sm text-muted-foreground">{tc("states.loading")}</p> : null}
      {!loading && rows.length === 0 ? (
        <EmptyState icon={<Webhook className="size-5" />} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : null}
      {rows.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.name")}</TableHead>
              <TableHead>{t("columns.url")}</TableHead>
              <TableHead>{t("columns.events")}</TableHead>
              <TableHead>{t("columns.enabled")}</TableHead>
              <TableHead>{t("columns.updated")}</TableHead>
              <TableHead>{t("columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="max-w-xs">
                  <div className="truncate">{row.name}</div>
                  {row.description?.trim() ? (
                    <div className="truncate text-xs text-muted-foreground">{row.description}</div>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-xs truncate">{row.url}</TableCell>
                <TableCell>{row.event_types.map(eventLabel).join("、")}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Switch checked={row.enabled} onCheckedChange={(checked) => void toggle(row, checked === true)} />
                    {row.disabled_reason ? (
                      <span className="text-xs text-destructive">{disabledReasonLabel(row.disabled_reason)}</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>{new Date(row.updated_at).toLocaleString()}</TableCell>
                <TableCell className="space-x-2">
                  <Button variant="outline" size="sm" onClick={() => openEdit(row)}>
                    {t("actions.edit")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void rotate(row)}>{t("actions.rotate")}</Button>
                  <Button variant="outline" size="sm" onClick={() => void openHistory(row)}>{t("actions.deliveries")}</Button>
                  <Button variant="outline" size="sm" onClick={() => setPendingDelete(row)}>{t("actions.delete")}</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      <Dialog open={editor !== null} onOpenChange={(open) => !saving && !open && setEditor(null)}>
        <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden bg-popover sm:max-w-2xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>{editor?.id ? t("actions.edit") : t("submitCreate")}</DialogTitle>
          </DialogHeader>
          {editor ? (
            <div className="min-h-0 max-h-[70vh] flex-1 space-y-4 overflow-y-auto">
              <div className="space-y-1">
                <Label htmlFor="webhook-url">{t("fields.url")}</Label>
                <Input
                  id="webhook-url"
                  value={editor.url}
                  placeholder={t("fields.urlPlaceholder")}
                  onChange={(event) => setEditor({ ...editor, url: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="webhook-name">{t("fields.name")}</Label>
                  <span className="text-xs tabular-nums text-muted-foreground">{`${editor.name.length}/${NAME_MAX}`}</span>
                </div>
                <Input
                  id="webhook-name"
                  maxLength={NAME_MAX}
                  value={editor.name}
                  onChange={(event) => setEditor({ ...editor, name: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="webhook-description">{t("fields.description")}</Label>
                  <span className="text-xs tabular-nums text-muted-foreground">{`${editor.description.length}/${DESCRIPTION_MAX}`}</span>
                </div>
                <Textarea
                  id="webhook-description"
                  maxLength={DESCRIPTION_MAX}
                  rows={4}
                  value={editor.description}
                  placeholder={t("fields.descriptionPlaceholder")}
                  onChange={(event) => setEditor({ ...editor, description: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-foreground">{t("fields.eventTypes")}</span>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <Checkbox
                        checked={checkedState(selectedCount, WEBHOOK_EVENT_TYPES.length)}
                        aria-label={t("selectAll")}
                        onCheckedChange={(checked) => {
                          setEventTypes(checked === true ? [...WEBHOOK_EVENT_TYPES] : []);
                        }}
                      />
                      {t("selectAll")}
                    </label>
                    <span className="text-sm text-muted-foreground">
                      {t("selectedCount", { selected: selectedCount, total: WEBHOOK_EVENT_TYPES.length })}
                    </span>
                  </div>
                </div>
                {WEBHOOK_EVENT_GROUPS.map((group) => {
                  const groupLabel = eventGroupLabel(group.key);
                  const selectedInGroup = group.types.filter((type) => selectedEvents.has(type)).length;
                  return (
                    <div key={group.key} role="group" aria-label={groupLabel} className="rounded-lg border border-border bg-card">
                      <div className="flex items-center justify-between gap-3 px-3 py-2">
                        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <Checkbox
                            checked={checkedState(selectedInGroup, group.types.length)}
                            aria-label={groupLabel}
                            onCheckedChange={(checked) => {
                              if (!editor) return;
                              setEventTypes(applyGroupSelection(editor.eventTypes, group.types, checked === true));
                            }}
                          />
                          {groupLabel}
                        </label>
                        <span className="text-sm tabular-nums text-muted-foreground">{`${selectedInGroup} / ${group.types.length}`}</span>
                      </div>
                      <div className="space-y-1 border-t border-border px-3 py-2">
                        {group.types.map((eventType) => {
                          const label = eventLabel(eventType);
                          return (
                            <label key={eventType} className="flex items-center gap-2 py-1 pl-6 text-sm text-foreground">
                              <Checkbox
                                checked={selectedEvents.has(eventType)}
                                aria-label={label}
                                onCheckedChange={() => {
                                  if (!editor) return;
                                  setEventTypes(toggleEvent(editor.eventTypes, eventType));
                                }}
                              />
                              <span>{label}</span>
                              <span className="font-mono text-xs text-muted-foreground">{eventType}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="rounded-lg border border-border bg-card">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-foreground"
                  aria-expanded={advancedOpen}
                  onClick={() => setAdvancedOpen((open) => !open)}
                >
                  {t("advanced")}
                  {advancedOpen ? (
                    <ChevronDown className="size-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-4 text-muted-foreground" />
                  )}
                </button>
                {advancedOpen ? (
                  <div className="space-y-3 border-t border-border px-3 py-3">
                    <div className="space-y-1">
                      <Label>{t("fields.agents")}</Label>
                      <p className="text-xs text-muted-foreground">{t("fields.agentsHint")}</p>
                      {agents.map((agent) => (
                        <label key={agent.id} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={editor.agentIds.includes(agent.id)}
                            aria-label={agent.displayName || agent.slug || agent.id}
                            onCheckedChange={() => setEditor({ ...editor, agentIds: toggleValue(editor.agentIds, agent.id) })}
                          />
                          {agent.displayName || agent.slug || agent.id}
                        </label>
                      ))}
                    </div>
                    <div className="space-y-1">
                      <Label>{t("fields.sources")}</Label>
                      <p className="text-xs text-muted-foreground">{t("fields.sourcesHint")}</p>
                      {SOURCES.map((source) => (
                        <label key={source} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={editor.sources.includes(source)}
                            aria-label={sourceLabel(source)}
                            onCheckedChange={() => setEditor({ ...editor, sources: toggleValue(editor.sources, source) })}
                          />
                          {sourceLabel(source)}
                        </label>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <Switch
                        checked={editor.includeResultText}
                        onCheckedChange={(checked) => setEditor({ ...editor, includeResultText: checked === true })}
                      />
                      {t("fields.includeResult")}
                    </label>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="shrink-0 space-y-3 border-t border-border bg-popover pt-4">
            {editorError ? <p className="text-sm text-destructive">{editorError}</p> : null}
            <DialogFooter className="flex-row justify-end">
              <Button variant="outline" disabled={saving} onClick={() => setEditor(null)}>{tc("actions.cancel")}</Button>
              <Button disabled={saving} onClick={() => void save()}>
                {editor?.id ? tc("actions.save") : t("submitCreate")}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={secret !== null} onOpenChange={(open) => !open && setSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("secret.title")}</DialogTitle>
          </DialogHeader>
          <p className="break-all font-mono text-sm">{secret}</p>
          <p className="text-sm text-muted-foreground">{t("secret.once")}</p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (secret) void navigator.clipboard.writeText(secret);
              }}
            >
              {tc("actions.copy")}
            </Button>
            <Button onClick={() => setSecret(null)}>{tc("actions.closeSaved")}</Button>
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
                <TableHead>{t("historyColumns.event")}</TableHead>
                <TableHead>{t("historyColumns.status")}</TableHead>
                <TableHead>{t("historyColumns.attempts")}</TableHead>
                <TableHead>{t("historyColumns.code")}</TableHead>
                <TableHead>{t("historyColumns.error")}</TableHead>
                <TableHead>{t("historyColumns.when")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(history?.deliveries ?? []).map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell>{eventLabel(delivery.event_type)}</TableCell>
                  <TableCell>{delivery.status}</TableCell>
                  <TableCell>{delivery.attempts}</TableCell>
                  <TableCell>{delivery.last_status_code ?? "—"}</TableCell>
                  <TableCell>{delivery.last_error || "—"}</TableCell>
                  <TableCell>{new Date(delivery.created_at).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SheetContent>
      </Sheet>
    </div>
  );
}
