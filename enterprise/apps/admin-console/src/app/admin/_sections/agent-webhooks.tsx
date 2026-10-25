"use client";

import { useCallback, useEffect, useState } from "react";
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
} from "@agenticx/ui";
import { Webhook } from "lucide-react";
import { useTranslations } from "next-intl";

import { adminFetch } from "../../../lib/admin-client-auth";

const EVENT_TYPES = ["session.idle", "session.failed", "credential.expiring"] as const;
const SOURCES = ["portal", "desktop", "api", "schedule", "channel", "eval"] as const;

type EventType = (typeof EVENT_TYPES)[number];
type Source = (typeof SOURCES)[number];

type WebhookRow = {
  id: string;
  name: string;
  url: string;
  event_types: string[];
  agent_ids: string[];
  sources: string[];
  include_result_text: boolean;
  enabled: boolean;
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
  eventTypes: EventType[];
  agentIds: string[];
  sources: Source[];
  includeResultText: boolean;
};

const EMPTY_EDITOR: Editor = {
  id: null,
  name: "",
  url: "",
  eventTypes: ["session.idle"],
  agentIds: [],
  sources: [],
  includeResultText: false,
};

function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

function isSource(value: string): value is Source {
  return (SOURCES as readonly string[]).includes(value);
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
    switch (value) {
      case "session.idle":
        return t("events.idle");
      case "session.failed":
        return t("events.failed");
      case "credential.expiring":
        return t("events.expiring");
      default: {
        const unreachable: never = value;
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
    setSaving(true);
    setEditorError("");
    const payload = {
      name: editor.name,
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

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={<Button onClick={() => { setEditorError(""); setEditor(EMPTY_EDITOR); }}>{t("create")}</Button>}
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
                <TableCell>{row.name}</TableCell>
                <TableCell className="max-w-xs truncate">{row.url}</TableCell>
                <TableCell>{row.event_types.map(eventLabel).join("、")}</TableCell>
                <TableCell>
                  <Switch checked={row.enabled} onCheckedChange={(checked) => void toggle(row, checked === true)} />
                </TableCell>
                <TableCell>{new Date(row.updated_at).toLocaleString()}</TableCell>
                <TableCell className="space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditorError("");
                      setEditor({
                        id: row.id,
                        name: row.name,
                        url: row.url,
                        eventTypes: row.event_types.filter(isEventType),
                        agentIds: row.agent_ids,
                        sources: row.sources.filter(isSource),
                        includeResultText: row.include_result_text,
                      });
                    }}
                  >
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
        <DialogContent className="max-h-[85vh] overflow-y-auto">
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
                <Label>{t("fields.url")}</Label>
                <Input value={editor.url} onChange={(event) => setEditor({ ...editor, url: event.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>{t("fields.events")}</Label>
                {EVENT_TYPES.map((eventType) => (
                  <label key={eventType} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={editor.eventTypes.includes(eventType)}
                      onCheckedChange={() => setEditor({ ...editor, eventTypes: toggleValue(editor.eventTypes, eventType) })}
                    />
                    {eventLabel(eventType)}
                  </label>
                ))}
              </div>
              <div className="space-y-1">
                <Label>{t("fields.agents")}</Label>
                <p className="text-xs text-muted-foreground">{t("fields.agentsHint")}</p>
                {agents.map((agent) => (
                  <label key={agent.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={editor.agentIds.includes(agent.id)}
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
              {editorError ? <p className="text-sm text-destructive">{editorError}</p> : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setEditor(null)}>{tc("actions.cancel")}</Button>
            <Button disabled={saving} onClick={() => void save()}>{tc("actions.save")}</Button>
          </DialogFooter>
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
