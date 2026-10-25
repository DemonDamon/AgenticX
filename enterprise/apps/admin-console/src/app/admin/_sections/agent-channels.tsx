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
} from "@agenticx/ui";
import { MessagesSquare } from "lucide-react";
import { useTranslations } from "next-intl";

import { adminFetch } from "../../../lib/admin-client-auth";

type Routing = "follow_latest" | "pinned";
type ConnectionStatus = "pending" | "starting" | "running" | "error" | "stopped";
type ConversationType = "p2p" | "group";

type ChannelRow = {
  id: string;
  name: string;
  agent_id: string;
  routing: Routing;
  pinned_version: number | null;
  environment_id: string | null;
  app_id: string;
  credential: { vault_id: string; credential_id: string };
  config: { idle_reset_hours: number; open_base_url: string };
  enabled: boolean;
  connection: { status: ConnectionStatus; last_error: string | null };
};

type ConversationRow = {
  conversation_key: string;
  conversation_type: ConversationType;
  session_id: string;
  agent_version: number;
  last_message_at: string;
};

type AgentOption = { id: string; displayName?: string; display_name?: string; slug?: string };
type EnvOption = { id: string; name: string; status?: string };
type VaultOption = { id: string; display_name: string; status?: string };
type CredentialOption = { id: string; display_name: string | null; type: string; status?: string; auth?: { secret_name?: string } };

type Editor = {
  id: string | null;
  name: string;
  agentId: string;
  routing: Routing;
  pinnedVersion: string;
  environmentId: string;
  appId: string;
  vaultId: string;
  credentialId: string;
  site: "feishu" | "lark";
  idleHours: string;
};

const EMPTY_EDITOR: Editor = {
  id: null,
  name: "",
  agentId: "",
  routing: "follow_latest",
  pinnedVersion: "",
  environmentId: "",
  appId: "",
  vaultId: "",
  credentialId: "",
  site: "feishu",
  idleHours: "24",
};

function isConnectionStatus(value: string): value is ConnectionStatus {
  return value === "pending" || value === "starting" || value === "running" || value === "error" || value === "stopped";
}

function isConversationType(value: string): value is ConversationType {
  return value === "p2p" || value === "group";
}

async function readEnvelope(response: Response): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
  const body = (await response.json().catch(() => null)) as { code?: string; message?: string; data?: unknown } | null;
  if (!response.ok || !body || body.code !== "00000") {
    return { ok: false, message: body?.message || `HTTP ${response.status}` };
  }
  return { ok: true, data: body.data };
}

export default function AgentChannelsSection() {
  const t = useTranslations("pages.admin.agentChannels");
  const tc = useTranslations("common");
  const [rows, setRows] = useState<ChannelRow[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [environments, setEnvironments] = useState<EnvOption[]>([]);
  const [vaults, setVaults] = useState<VaultOption[]>([]);
  const [credentials, setCredentials] = useState<CredentialOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorError, setEditorError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ChannelRow | null>(null);
  const [conversations, setConversations] = useState<{ channel: ChannelRow; rows: ConversationRow[] } | null>(null);
  const [pageError, setPageError] = useState("");

  const agentName = useMemo(() => {
    const names = new Map(agents.map((agent) => [agent.id, agent.displayName || agent.display_name || agent.slug || agent.id]));
    return (id: string) => names.get(id) || id;
  }, [agents]);

  const vaultName = useMemo(() => {
    const names = new Map(vaults.map((vault) => [vault.id, vault.display_name]));
    return (id: string) => names.get(id) || id;
  }, [vaults]);

  const load = useCallback(async () => {
    setLoading(true);
    const [channelRes, agentRes, envRes, vaultRes] = await Promise.all([
      adminFetch("/api/admin/ma-channels", { cache: "no-store" }),
      adminFetch("/api/admin/agents", { cache: "no-store" }),
      adminFetch("/api/admin/ma-environments", { cache: "no-store" }),
      adminFetch("/api/admin/ma-vaults", { cache: "no-store" }),
    ]);
    const channelBody = await readEnvelope(channelRes);
    if (channelBody.ok && channelBody.data && typeof channelBody.data === "object") {
      const data = channelBody.data as { channels?: ChannelRow[] };
      setRows(Array.isArray(data.channels) ? data.channels : []);
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
    const vaultBody = await readEnvelope(vaultRes);
    if (vaultBody.ok && vaultBody.data && typeof vaultBody.data === "object") {
      const data = vaultBody.data as { vaults?: VaultOption[] };
      setVaults(Array.isArray(data.vaults) ? data.vaults.filter((item) => item.status !== "archived") : []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadCredentials = useCallback(async (vaultId: string) => {
    if (!vaultId) {
      setCredentials([]);
      return;
    }
    const response = await adminFetch(`/api/admin/ma-vaults/${vaultId}/credentials`, { cache: "no-store" });
    const body = await readEnvelope(response);
    if (!body.ok || !body.data || typeof body.data !== "object") {
      setCredentials([]);
      return;
    }
    const data = body.data as { credentials?: CredentialOption[] };
    const items = Array.isArray(data.credentials) ? data.credentials : [];
    setCredentials(items.filter((item) => item.type === "environment_variable" && item.status !== "archived"));
  }, []);

  useEffect(() => {
    if (!editor?.vaultId) return;
    void loadCredentials(editor.vaultId);
  }, [editor?.vaultId, loadCredentials]);

  function statusLabel(status: string): string {
    if (!isConnectionStatus(status)) return status;
    switch (status) {
      case "pending":
        return t("status.pending");
      case "starting":
        return t("status.starting");
      case "running":
        return t("status.running");
      case "error":
        return t("status.error");
      case "stopped":
        return t("status.stopped");
      default: {
        const unreachable: never = status;
        return unreachable;
      }
    }
  }

  function routingLabel(row: ChannelRow): string {
    switch (row.routing) {
      case "follow_latest":
        return t("policy.follow");
      case "pinned":
        return t("policy.pinned", { version: row.pinned_version ?? "" });
      default: {
        const unreachable: never = row.routing;
        return unreachable;
      }
    }
  }

  function conversationLabel(value: string): string {
    if (!isConversationType(value)) return value;
    switch (value) {
      case "p2p":
        return t("conversation.p2p");
      case "group":
        return t("conversation.group");
      default: {
        const unreachable: never = value;
        return unreachable;
      }
    }
  }

  function openCreate() {
    setEditorError("");
    setCredentials([]);
    setEditor({ ...EMPTY_EDITOR });
  }

  function openEdit(row: ChannelRow) {
    setEditorError("");
    setEditor({
      id: row.id,
      name: row.name,
      agentId: row.agent_id,
      routing: row.routing,
      pinnedVersion: row.pinned_version == null ? "" : String(row.pinned_version),
      environmentId: row.environment_id ?? "",
      appId: row.app_id,
      vaultId: row.credential.vault_id,
      credentialId: row.credential.credential_id,
      site: row.config.open_base_url === "https://open.larksuite.com" ? "lark" : "feishu",
      idleHours: String(row.config.idle_reset_hours),
    });
  }

  async function save() {
    if (!editor) return;
    setSaving(true);
    setEditorError("");
    const payload: Record<string, unknown> = {
      name: editor.name.trim(),
      agent_id: editor.agentId,
      routing: editor.routing,
      pinned_version: editor.routing === "pinned" ? Number(editor.pinnedVersion) : null,
      environment_id: editor.environmentId || null,
      credential: { vault_id: editor.vaultId, credential_id: editor.credentialId },
      config: {
        idle_reset_hours: Number(editor.idleHours),
        open_base_url: editor.site === "lark" ? "https://open.larksuite.com" : "https://open.feishu.cn",
      },
    };
    if (!editor.id) {
      payload.platform = "feishu";
      payload.app_id = editor.appId.trim();
    }
    const response = await adminFetch(editor.id ? `/api/admin/ma-channels/${editor.id}` : "/api/admin/ma-channels", {
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

  async function toggleEnabled(row: ChannelRow, enabled: boolean) {
    setPageError("");
    const response = await adminFetch(`/api/admin/ma-channels/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const body = await readEnvelope(response);
    if (!body.ok) {
      setPageError(body.message);
      return;
    }
    await load();
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setSaving(true);
    const response = await adminFetch(`/api/admin/ma-channels/${pendingDelete.id}`, { method: "DELETE" });
    const body = await readEnvelope(response);
    setSaving(false);
    if (!body.ok) {
      setPageError(body.message);
      return;
    }
    setPendingDelete(null);
    await load();
  }

  async function openConversations(row: ChannelRow) {
    const response = await adminFetch(`/api/admin/ma-channels/${row.id}/conversations?limit=50`, { cache: "no-store" });
    const body = await readEnvelope(response);
    const data = body.ok && body.data && typeof body.data === "object" ? (body.data as { conversations?: ConversationRow[] }) : null;
    setConversations({ channel: row, rows: Array.isArray(data?.conversations) ? data.conversations : [] });
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="flex justify-end">
        <Button onClick={openCreate}>{t("create")}</Button>
      </div>
      {pageError ? <p className="text-sm text-destructive">{pageError}</p> : null}
      {loading ? null : rows.length === 0 ? (
        <EmptyState icon={<MessagesSquare className="size-5" />} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.name")}</TableHead>
              <TableHead>{t("columns.agent")}</TableHead>
              <TableHead>{t("columns.policy")}</TableHead>
              <TableHead>{t("columns.appId")}</TableHead>
              <TableHead>{t("columns.connection")}</TableHead>
              <TableHead>{t("columns.enabled")}</TableHead>
              <TableHead>{t("columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.name}</TableCell>
                <TableCell>{agentName(row.agent_id)}</TableCell>
                <TableCell>{routingLabel(row)}</TableCell>
                <TableCell>{row.app_id}</TableCell>
                <TableCell>
                  <span title={row.connection.status === "error" ? row.connection.last_error ?? "" : undefined}>
                    {statusLabel(row.connection.status)}
                  </span>
                </TableCell>
                <TableCell>
                  <Switch checked={row.enabled} onCheckedChange={(checked) => void toggleEnabled(row, checked)} />
                </TableCell>
                <TableCell className="space-x-2">
                  <Button variant="outline" size="sm" onClick={() => openEdit(row)}>{t("actions.edit")}</Button>
                  <Button variant="outline" size="sm" onClick={() => void openConversations(row)}>{t("actions.sessions")}</Button>
                  <Button variant="outline" size="sm" onClick={() => setPendingDelete(row)}>{t("actions.delete")}</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={editor !== null} onOpenChange={(open) => !open && !saving && setEditor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editor?.id ? t("editTitle") : t("createTitle")}</DialogTitle>
          </DialogHeader>
          {editor ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>{t("fields.name")}</Label>
                <Input value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>{t("fields.agent")}</Label>
                <Select value={editor.agentId} onValueChange={(value) => setEditor({ ...editor, agentId: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>{agentName(agent.id)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("fields.policy")}</Label>
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="channel-routing"
                      checked={editor.routing === "follow_latest"}
                      onChange={() => setEditor({ ...editor, routing: "follow_latest" })}
                    />
                    {t("policy.follow")}
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="channel-routing"
                      checked={editor.routing === "pinned"}
                      onChange={() => setEditor({ ...editor, routing: "pinned" })}
                    />
                    {t("policy.pinnedChoice")}
                  </label>
                </div>
              </div>
              {editor.routing === "pinned" ? (
                <div className="space-y-1">
                  <Label>{t("fields.version")}</Label>
                  <Input value={editor.pinnedVersion} onChange={(event) => setEditor({ ...editor, pinnedVersion: event.target.value })} />
                </div>
              ) : null}
              <div className="space-y-1">
                <Label>{t("fields.environment")}</Label>
                <Select
                  value={editor.environmentId || "__none__"}
                  onValueChange={(value) => setEditor({ ...editor, environmentId: value === "__none__" ? "" : value })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("fields.environmentEmpty")}</SelectItem>
                    {environments.map((environment) => (
                      <SelectItem key={environment.id} value={environment.id}>{environment.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("fields.appId")}</Label>
                <Input
                  value={editor.appId}
                  disabled={Boolean(editor.id)}
                  onChange={(event) => setEditor({ ...editor, appId: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>{t("fields.vault")}</Label>
                <Select
                  value={editor.vaultId}
                  onValueChange={(value) => setEditor({ ...editor, vaultId: value, credentialId: "" })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {vaults.map((vault) => (
                      <SelectItem key={vault.id} value={vault.id}>{vault.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t("fields.vaultHint", { name: editor.vaultId ? vaultName(editor.vaultId) : "—" })}</p>
              </div>
              <div className="space-y-1">
                <Label>{t("fields.credential")}</Label>
                <Select value={editor.credentialId} onValueChange={(value) => setEditor({ ...editor, credentialId: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {credentials.map((credential) => (
                      <SelectItem key={credential.id} value={credential.id}>
                        {credential.display_name || credential.auth?.secret_name || credential.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("fields.site")}</Label>
                <Select
                  value={editor.site}
                  onValueChange={(value) => {
                    if (value !== "feishu" && value !== "lark") return;
                    setEditor({ ...editor, site: value });
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="feishu">{t("site.feishu")}</SelectItem>
                    <SelectItem value="lark">{t("site.lark")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("fields.idle")}</Label>
                <Input value={editor.idleHours} onChange={(event) => setEditor({ ...editor, idleHours: event.target.value })} />
              </div>
              {editorError ? <p className="text-sm text-destructive">{editorError}</p> : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setEditor(null)}>{tc("actions.cancel")}</Button>
            <Button disabled={saving} onClick={() => void save()}>{tc("actions.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && !saving && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("delete.title")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("delete.description")}</p>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setPendingDelete(null)}>{tc("actions.cancel")}</Button>
            <Button variant="destructive" disabled={saving} onClick={() => void confirmDelete()}>{t("actions.delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={conversations !== null} onOpenChange={(open) => !open && setConversations(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>{t("sessionsTitle")}</SheetTitle>
          </SheetHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("sessionColumns.type")}</TableHead>
                <TableHead>{t("sessionColumns.session")}</TableHead>
                <TableHead>{t("sessionColumns.version")}</TableHead>
                <TableHead>{t("sessionColumns.when")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(conversations?.rows ?? []).map((row) => (
                <TableRow key={row.conversation_key}>
                  <TableCell>{conversationLabel(row.conversation_type)}</TableCell>
                  <TableCell>
                    <Link href={`/ops/logs/managed/${row.session_id}`}>{row.session_id}</Link>
                  </TableCell>
                  <TableCell>{row.agent_version}</TableCell>
                  <TableCell>{new Date(row.last_message_at).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SheetContent>
      </Sheet>
    </div>
  );
}
