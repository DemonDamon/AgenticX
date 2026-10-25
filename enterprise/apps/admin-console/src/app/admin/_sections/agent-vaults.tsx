"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
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
  toast,
} from "@agenticx/ui";
import { LockKeyhole } from "lucide-react";
import { useTranslations } from "next-intl";

import { adminFetch } from "../../../lib/admin-client-auth";

type VaultStatus = "active" | "archived";
type CredType = "static_bearer" | "mcp_oauth" | "bearer" | "environment_variable";
type AuthType = "none" | "client_secret_basic" | "client_secret_post";

type VaultRow = {
  id: string;
  display_name: string;
  description: string | null;
  status: VaultStatus;
  credential_count: number;
  created_at: string;
};

type CredentialAuth =
  | { type: "static_bearer"; mcp_server_url: string }
  | { type: "bearer"; host: string }
  | { type: "environment_variable"; secret_name: string; networking: { type: "unrestricted" } | { type: "limited"; allowed_hosts: string[] } }
  | {
      type: "mcp_oauth";
      mcp_server_url: string;
      refresh: null | { token_endpoint_auth: { type: AuthType } };
    };

type CredentialRow = {
  id: string;
  display_name: string | null;
  type: CredType;
  status: VaultStatus;
  expires_at: string | null;
  last_rotated_at: string | null;
  last_resolved_at: string | null;
  auth: CredentialAuth;
};

type References = {
  sessions: { active_count: number; recent: Array<{ id: string; status: string; created_at: string }> };
  agents: Array<{ id: string; display_name: string; latest_version: number }>;
};

type Draft = {
  type: CredType;
  displayName: string;
  mcpUrl: string;
  host: string;
  token: string;
  accessToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  tokenEndpoint: string;
  authType: AuthType;
  scope: string;
  expiresAt: string;
  secretName: string;
  secretValue: string;
  network: "limited" | "unrestricted";
  hosts: string;
  clearRefresh: boolean;
};

const CRED_TYPES: CredType[] = ["static_bearer", "mcp_oauth", "bearer", "environment_variable"];

const EMPTY_DRAFT: Draft = {
  type: "static_bearer",
  displayName: "",
  mcpUrl: "",
  host: "",
  token: "",
  accessToken: "",
  refreshToken: "",
  clientId: "",
  clientSecret: "",
  tokenEndpoint: "",
  authType: "none",
  scope: "",
  expiresAt: "",
  secretName: "",
  secretValue: "",
  network: "limited",
  hosts: "",
  clearRefresh: false,
};

function isCredType(value: string): value is CredType {
  return CRED_TYPES.includes(value as CredType);
}

function isAuthType(value: string): value is AuthType {
  return value === "none" || value === "client_secret_basic" || value === "client_secret_post";
}

function stamp(value: string | null): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}

function targetOf(row: CredentialRow): string {
  switch (row.auth.type) {
    case "static_bearer":
    case "mcp_oauth":
      return row.auth.mcp_server_url;
    case "bearer":
      return row.auth.host;
    case "environment_variable":
      return row.auth.secret_name;
    default: {
      const unreachable: never = row.auth;
      return String(unreachable);
    }
  }
}

function SecretField({ label, value, onChange, hint }: { label: string; value: string; onChange: (value: string) => void; hint?: string }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input type="password" autoComplete="new-password" value={value} onChange={(event) => onChange(event.target.value)} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default function AgentVaultsSection() {
  const t = useTranslations("pages.admin.agentVaults");
  const tc = useTranslations("common");
  const [rows, setRows] = useState<VaultRow[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [vaultName, setVaultName] = useState("");
  const [vaultDescription, setVaultDescription] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<VaultRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [credentials, setCredentials] = useState<CredentialRow[]>([]);
  const [references, setReferences] = useState<References | null>(null);
  const [draftMode, setDraftMode] = useState<"create" | "rotate" | null>(null);
  const [rotateTarget, setRotateTarget] = useState<CredentialRow | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [pendingArchive, setPendingArchive] = useState<{ kind: "vault" | "credential"; row: VaultRow | CredentialRow } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ kind: "vault" | "credential"; row: VaultRow | CredentialRow } | null>(null);
  const [deleteName, setDeleteName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = includeArchived ? "?include_archived=true" : "";
      const res = await adminFetch(`/api/admin/ma-vaults${query}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { message?: string; data?: { vaults?: VaultRow[] } };
      if (!res.ok) throw new Error(json.message || tc("toast.loadFailed"));
      setRows(json.data?.vaults ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [includeArchived, tc]);

  useEffect(() => {
    void load();
  }, [load]);

  async function readError(res: Response): Promise<string> {
    const json = (await res.json().catch(() => ({}))) as { message?: string };
    return json.message || tc("toast.saveFailed");
  }

  async function openDetail(row: VaultRow) {
    setSelected(row);
    setEditName(row.display_name);
    setEditDescription(row.description ?? "");
    setCredentials([]);
    setReferences(null);
    const query = includeArchived ? "?include_archived=true" : "";
    const [credRes, refRes] = await Promise.all([
      adminFetch(`/api/admin/ma-vaults/${row.id}/credentials${query}`, { cache: "no-store" }),
      adminFetch(`/api/admin/ma-vaults/${row.id}/references`, { cache: "no-store" }),
    ]);
    const credJson = (await credRes.json().catch(() => ({}))) as { message?: string; data?: { credentials?: CredentialRow[] } };
    const refJson = (await refRes.json().catch(() => ({}))) as { message?: string; data?: References };
    if (!credRes.ok) toast.error(credJson.message || tc("toast.loadFailed"));
    else setCredentials(credJson.data?.credentials ?? []);
    if (!refRes.ok) toast.error(refJson.message || tc("toast.loadFailed"));
    else setReferences(refJson.data ?? null);
  }

  async function saveVault() {
    if (!creating || saving) return;
    setSaving(true);
    setFormError("");
    try {
      const res = await adminFetch("/api/admin/ma-vaults", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display_name: vaultName, description: vaultDescription || null }),
      });
      if (!res.ok) {
        const message = await readError(res);
        setFormError(message);
        toast.error(message);
        return;
      }
      toast.success(t("toast.created"));
      setCreating(false);
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : tc("toast.saveFailed");
      setFormError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function saveBasics() {
    if (!selected || saving) return;
    setSaving(true);
    try {
      const res = await adminFetch(`/api/admin/ma-vaults/${selected.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display_name: editName, description: editDescription || null }),
      });
      if (!res.ok) {
        toast.error(await readError(res));
        return;
      }
      toast.success(t("toast.saved"));
      await load();
      setSelected((current) => (current ? { ...current, display_name: editName, description: editDescription || null } : current));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("toast.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function buildCreateAuth(): Record<string, unknown> {
    const display = draft.displayName.trim() ? { display_name: draft.displayName.trim() } : {};
    switch (draft.type) {
      case "static_bearer":
        return { ...display, auth: { type: draft.type, mcp_server_url: draft.mcpUrl.trim(), token: draft.token } };
      case "bearer":
        return { ...display, auth: { type: draft.type, host: draft.host.trim(), token: draft.token } };
      case "environment_variable": {
        const hosts = draft.hosts.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
        const networking = draft.network === "unrestricted" ? { type: "unrestricted" } : { type: "limited", allowed_hosts: hosts };
        return {
          ...display,
          auth: { type: draft.type, secret_name: draft.secretName.trim(), secret_value: draft.secretValue, networking },
        };
      }
      case "mcp_oauth": {
        const auth: Record<string, unknown> = {
          type: draft.type,
          mcp_server_url: draft.mcpUrl.trim(),
          access_token: draft.accessToken,
        };
        if (draft.expiresAt) auth.expires_at = new Date(draft.expiresAt).toISOString();
        if (draft.tokenEndpoint.trim()) {
          const tokenAuth: Record<string, unknown> = { type: draft.authType };
          if (draft.authType !== "none") tokenAuth.client_secret = draft.clientSecret;
          auth.refresh = {
            token_endpoint: draft.tokenEndpoint.trim(),
            client_id: draft.clientId.trim(),
            ...(draft.scope.trim() ? { scope: draft.scope.trim() } : {}),
            refresh_token: draft.refreshToken,
            token_endpoint_auth: tokenAuth,
          };
        }
        return { ...display, auth };
      }
      default: {
        const unreachable: never = draft.type;
        return unreachable;
      }
    }
  }

  function buildRotateAuth(): Record<string, unknown> {
    if (!rotateTarget) return { auth: { type: draft.type } };
    const auth: Record<string, unknown> = { type: rotateTarget.type };
    switch (rotateTarget.type) {
      case "static_bearer":
      case "bearer":
        if (draft.token) auth.token = draft.token;
        break;
      case "environment_variable":
        if (draft.secretValue) auth.secret_value = draft.secretValue;
        break;
      case "mcp_oauth":
        if (draft.accessToken) auth.access_token = draft.accessToken;
        if (draft.expiresAt) auth.expires_at = new Date(draft.expiresAt).toISOString();
        if (draft.clearRefresh) auth.refresh = null;
        else if (draft.refreshToken || draft.clientSecret) {
          const current = rotateTarget.auth.type === "mcp_oauth" ? rotateTarget.auth.refresh?.token_endpoint_auth.type ?? "none" : "none";
          const refresh: Record<string, unknown> = {};
          if (draft.refreshToken) refresh.refresh_token = draft.refreshToken;
          if (draft.clientSecret) refresh.token_endpoint_auth = { type: current === "none" ? "client_secret_post" : current, client_secret: draft.clientSecret };
          auth.refresh = refresh;
        }
        break;
      default: {
        const unreachable: never = rotateTarget.type;
        return unreachable;
      }
    }
    return { auth };
  }

  async function saveCredential() {
    if (!selected || !draftMode || saving) return;
    setSaving(true);
    setFormError("");
    const path =
      draftMode === "create"
        ? `/api/admin/ma-vaults/${selected.id}/credentials`
        : `/api/admin/ma-vaults/${selected.id}/credentials/${rotateTarget?.id}`;
    try {
      const res = await adminFetch(path, {
        method: draftMode === "create" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draftMode === "create" ? buildCreateAuth() : buildRotateAuth()),
      });
      if (!res.ok) {
        const message = await readError(res);
        setFormError(message);
        toast.error(message);
        return;
      }
      toast.success(draftMode === "create" ? t("toast.credentialCreated") : t("toast.rotated"));
      setDraftMode(null);
      setRotateTarget(null);
      setDraft(EMPTY_DRAFT);
      await openDetail(selected);
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : tc("toast.saveFailed");
      setFormError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmArchive() {
    if (!pendingArchive || saving) return;
    setSaving(true);
    try {
      const path =
        pendingArchive.kind === "vault"
          ? `/api/admin/ma-vaults/${pendingArchive.row.id}/archive`
          : `/api/admin/ma-vaults/${selected?.id}/credentials/${pendingArchive.row.id}/archive`;
      const res = await adminFetch(path, { method: "POST" });
      if (!res.ok) {
        toast.error(await readError(res));
        return;
      }
      toast.success(t("toast.archived"));
      setPendingArchive(null);
      await load();
      if (selected) await openDetail(selected);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("toast.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || saving) return;
    if (pendingDelete.kind === "vault" && deleteName !== pendingDelete.row.display_name) return;
    setSaving(true);
    try {
      const path =
        pendingDelete.kind === "vault"
          ? `/api/admin/ma-vaults/${pendingDelete.row.id}`
          : `/api/admin/ma-vaults/${selected?.id}/credentials/${pendingDelete.row.id}`;
      const res = await adminFetch(path, { method: "DELETE" });
      if (!res.ok) {
        const message = await readError(res);
        setFormError(message);
        toast.error(message);
        return;
      }
      toast.success(t("toast.deleted"));
      const closedVault = pendingDelete.kind === "vault";
      setPendingDelete(null);
      setDeleteName("");
      if (closedVault) setSelected(null);
      await load();
      if (!closedVault && selected) await openDetail(selected);
    } catch (error) {
      const message = error instanceof Error ? error.message : tc("toast.saveFailed");
      setFormError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const deleteVaultBlocked = pendingDelete?.kind === "vault" && deleteName !== (pendingDelete.row as VaultRow).display_name;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex items-center gap-3">
            <Label className="flex items-center gap-2 text-sm">
              <Switch checked={includeArchived} onCheckedChange={setIncludeArchived} />
              {t("showArchived")}
            </Label>
            <Button
              onClick={() => {
                setVaultName("");
                setVaultDescription("");
                setFormError("");
                setCreating(true);
              }}
            >
              {t("create")}
            </Button>
          </div>
        }
      />
      {loading ? <p className="text-sm text-muted-foreground">{tc("states.loading")}</p> : null}
      {!loading && rows.length === 0 ? (
        <EmptyState icon={<LockKeyhole className="size-5" />} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : null}
      {!loading && rows.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.name")}</TableHead>
              <TableHead>{t("columns.description")}</TableHead>
              <TableHead>{t("columns.count")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead>{t("columns.createdAt")}</TableHead>
              <TableHead>{t("columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.display_name}</TableCell>
                <TableCell>{row.description || "—"}</TableCell>
                <TableCell>{row.credential_count}</TableCell>
                <TableCell>{t(`status.${row.status}`)}</TableCell>
                <TableCell>{stamp(row.created_at)}</TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => void openDetail(row)}>
                    {t("actions.detail")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      <Dialog open={creating} onOpenChange={(open) => !saving && !open && setCreating(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("form.createTitle")}</DialogTitle>
          </DialogHeader>
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          <div className="space-y-1">
            <Label>{t("form.name")}</Label>
            <Input value={vaultName} onChange={(event) => setVaultName(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("form.description")}</Label>
            <Textarea value={vaultDescription} onChange={(event) => setVaultDescription(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setCreating(false)}>
              {t("actions.cancel")}
            </Button>
            <Button disabled={saving} onClick={() => void saveVault()}>
              {t("actions.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{selected?.display_name}</SheetTitle>
          </SheetHeader>
          {selected ? (
            <div className="mt-4 space-y-6">
              <section className="space-y-3">
                <h3 className="text-sm font-medium">{t("form.basic")}</h3>
                <div className="space-y-1">
                  <Label>{t("form.name")}</Label>
                  <Input value={editName} disabled={selected.status === "archived"} onChange={(event) => setEditName(event.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>{t("form.description")}</Label>
                  <Textarea value={editDescription} disabled={selected.status === "archived"} onChange={(event) => setEditDescription(event.target.value)} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button disabled={saving || selected.status === "archived"} onClick={() => void saveBasics()}>
                    {t("actions.save")}
                  </Button>
                </div>
              </section>
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">{t("credential.createTitle")}</h3>
                  {selected.status === "active" ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setDraft(EMPTY_DRAFT);
                        setFormError("");
                        setRotateTarget(null);
                        setDraftMode("create");
                      }}
                    >
                      {t("actions.addCredential")}
                    </Button>
                  ) : null}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("credColumns.name")}</TableHead>
                      <TableHead>{t("credColumns.type")}</TableHead>
                      <TableHead>{t("credColumns.target")}</TableHead>
                      <TableHead>{t("credColumns.status")}</TableHead>
                      <TableHead>{t("credColumns.expires")}</TableHead>
                      <TableHead>{t("credColumns.rotated")}</TableHead>
                      <TableHead>{t("credColumns.used")}</TableHead>
                      <TableHead>{t("credColumns.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {credentials.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{row.display_name || "—"}</TableCell>
                        <TableCell>{t(`types.${row.type}`)}</TableCell>
                        <TableCell className="max-w-[160px] truncate">{targetOf(row)}</TableCell>
                        <TableCell>{t(`status.${row.status}`)}</TableCell>
                        <TableCell>{stamp(row.expires_at)}</TableCell>
                        <TableCell>{stamp(row.last_rotated_at)}</TableCell>
                        <TableCell>{stamp(row.last_resolved_at)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            {row.status === "active" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setDraft({ ...EMPTY_DRAFT, type: row.type });
                                  setRotateTarget(row);
                                  setFormError("");
                                  setDraftMode("rotate");
                                }}
                              >
                                {t("actions.rotate")}
                              </Button>
                            ) : null}
                            {row.status === "active" ? (
                              <Button size="sm" variant="outline" onClick={() => setPendingArchive({ kind: "credential", row })}>
                                {t("actions.archive")}
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setFormError("");
                                setDeleteName("");
                                setPendingDelete({ kind: "credential", row });
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
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-medium">{t("references.title")}</h3>
                <p className="text-sm">{t("references.sessions", { count: references?.sessions.active_count ?? 0 })}</p>
                {references && references.sessions.recent.length === 0 ? <p className="text-sm text-muted-foreground">{t("references.emptySessions")}</p> : null}
                <ul className="space-y-1 text-sm">
                  {(references?.sessions.recent ?? []).map((session) => (
                    <li key={session.id}>
                      <Link className="text-primary underline-offset-4 hover:underline" href={`/ops/logs/managed/${session.id}`}>
                        {session.id}
                      </Link>
                      <span className="text-muted-foreground"> · {session.status} · {stamp(session.created_at)}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-sm">{t("references.agents")}</p>
                {references && references.agents.length === 0 ? <p className="text-sm text-muted-foreground">{t("references.emptyAgents")}</p> : null}
                <ul className="space-y-1 text-sm">
                  {(references?.agents ?? []).map((agent) => (
                    <li key={agent.id}>{t("references.agentLine", { name: agent.display_name, version: agent.latest_version })}</li>
                  ))}
                </ul>
              </section>
              {selected.status === "active" ? (
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setPendingArchive({ kind: "vault", row: selected })}>
                    {t("actions.archive")}
                  </Button>
                </div>
              ) : (
                <div className="flex justify-end">
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setFormError("");
                      setDeleteName("");
                      setPendingDelete({ kind: "vault", row: selected });
                    }}
                  >
                    {t("actions.delete")}
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog open={draftMode !== null} onOpenChange={(open) => !saving && !open && setDraftMode(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draftMode === "rotate" ? t("credential.rotateTitle") : t("credential.createTitle")}</DialogTitle>
          </DialogHeader>
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          {draftMode === "create" ? (
            <div className="space-y-1">
              <Label>{t("credential.type")}</Label>
              <Select value={draft.type} onValueChange={(value) => isCredType(value) && setDraft({ ...EMPTY_DRAFT, type: value, displayName: draft.displayName })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CRED_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`types.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("credential.keepBlank")}</p>
          )}
          {draftMode === "create" ? (
            <div className="space-y-1">
              <Label>{t("credential.name")}</Label>
              <Input value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} />
            </div>
          ) : null}
          {draft.type === "static_bearer" || draft.type === "mcp_oauth" ? (
            draftMode === "create" ? (
              <div className="space-y-1">
                <Label>{t("credential.mcpUrl")}</Label>
                <Input value={draft.mcpUrl} onChange={(event) => setDraft({ ...draft, mcpUrl: event.target.value })} />
              </div>
            ) : null
          ) : null}
          {draft.type === "bearer" && draftMode === "create" ? (
            <div className="space-y-1">
              <Label>{t("credential.host")}</Label>
              <Input value={draft.host} onChange={(event) => setDraft({ ...draft, host: event.target.value })} />
            </div>
          ) : null}
          {draft.type === "static_bearer" || draft.type === "bearer" ? (
            <SecretField label={t("credential.token")} value={draft.token} onChange={(token) => setDraft({ ...draft, token })} hint={draftMode === "rotate" ? t("credential.keepBlank") : undefined} />
          ) : null}
          {draft.type === "mcp_oauth" ? (
            <>
              <SecretField label={t("credential.accessToken")} value={draft.accessToken} onChange={(accessToken) => setDraft({ ...draft, accessToken })} />
              <div className="space-y-1">
                <Label>{t("credential.expiresAt")}</Label>
                <Input type="datetime-local" value={draft.expiresAt} onChange={(event) => setDraft({ ...draft, expiresAt: event.target.value })} />
              </div>
              {draftMode === "rotate" ? (
                <Label className="flex items-center gap-2">
                  <Checkbox checked={draft.clearRefresh} onCheckedChange={(checked) => setDraft({ ...draft, clearRefresh: checked === true })} />
                  {t("credential.clearRefresh")}
                </Label>
              ) : null}
              {draftMode === "create" || !draft.clearRefresh ? (
                <>
                  <SecretField label={t("credential.refreshToken")} value={draft.refreshToken} onChange={(refreshToken) => setDraft({ ...draft, refreshToken })} />
                  {draftMode === "create" ? (
                    <>
                      <div className="space-y-1">
                        <Label>{t("credential.tokenEndpoint")}</Label>
                        <Input value={draft.tokenEndpoint} onChange={(event) => setDraft({ ...draft, tokenEndpoint: event.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label>{t("credential.clientId")}</Label>
                        <Input value={draft.clientId} onChange={(event) => setDraft({ ...draft, clientId: event.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label>{t("credential.authType")}</Label>
                        <Select value={draft.authType} onValueChange={(value) => isAuthType(value) && setDraft({ ...draft, authType: value, clientSecret: value === "none" ? "" : draft.clientSecret })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{t("authTypes.none")}</SelectItem>
                            <SelectItem value="client_secret_basic">{t("authTypes.client_secret_basic")}</SelectItem>
                            <SelectItem value="client_secret_post">{t("authTypes.client_secret_post")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  ) : null}
                  {draft.authType !== "none" || draftMode === "rotate" ? (
                    <SecretField label={t("credential.clientSecret")} value={draft.clientSecret} onChange={(clientSecret) => setDraft({ ...draft, clientSecret })} />
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
          {draft.type === "environment_variable" ? (
            <>
              {draftMode === "create" ? (
                <div className="space-y-1">
                  <Label>{t("credential.secretName")}</Label>
                  <Input value={draft.secretName} onChange={(event) => setDraft({ ...draft, secretName: event.target.value })} />
                </div>
              ) : null}
              <SecretField label={t("credential.secretValue")} value={draft.secretValue} onChange={(secretValue) => setDraft({ ...draft, secretValue })} />
              {draftMode === "create" ? (
                <div className="space-y-2">
                  <Label>{t("networking.label")}</Label>
                  <Label className="flex items-center gap-2">
                    <input type="radio" checked={draft.network === "limited"} onChange={() => setDraft({ ...draft, network: "limited" })} />
                    {t("networking.limited")}
                  </Label>
                  <Label className="flex items-center gap-2">
                    <input type="radio" checked={draft.network === "unrestricted"} onChange={() => setDraft({ ...draft, network: "unrestricted" })} />
                    {t("networking.unrestricted")}
                  </Label>
                  {draft.network === "limited" ? (
                    <div className="space-y-1">
                      <Label>{t("networking.hosts")}</Label>
                      <Textarea value={draft.hosts} onChange={(event) => setDraft({ ...draft, hosts: event.target.value })} />
                      <p className="text-xs text-muted-foreground">{t("networking.hint")}</p>
                    </div>
                  ) : (
                    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">{t("networking.warning")}</p>
                  )}
                </div>
              ) : null}
            </>
          ) : null}
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setDraftMode(null)}>
              {t("actions.cancel")}
            </Button>
            <Button disabled={saving} onClick={() => void saveCredential()}>
              {t("actions.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingArchive !== null} onOpenChange={(open) => !saving && !open && setPendingArchive(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingArchive?.kind === "vault" ? t("archive.vaultTitle") : t("archive.credentialTitle")}</DialogTitle>
            <DialogDescription>{pendingArchive?.kind === "vault" ? t("archive.vault") : t("archive.credential")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setPendingArchive(null)}>
              {t("actions.cancel")}
            </Button>
            <Button disabled={saving} onClick={() => void confirmArchive()}>
              {t("archive.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (saving || open) return;
          setPendingDelete(null);
          setDeleteName("");
          setFormError("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingDelete?.kind === "vault" ? t("delete.vaultTitle") : t("delete.credentialTitle")}</DialogTitle>
            <DialogDescription>{pendingDelete?.kind === "vault" ? t("delete.vault") : t("delete.credential")}</DialogDescription>
          </DialogHeader>
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          {pendingDelete?.kind === "vault" ? (
            <div className="space-y-1">
              <Label>{t("delete.namePrompt")}</Label>
              <Input value={deleteName} onChange={(event) => setDeleteName(event.target.value)} />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setPendingDelete(null)}>
              {t("actions.cancel")}
            </Button>
            <Button variant="destructive" disabled={saving || deleteVaultBlocked} onClick={() => void confirmDelete()}>
              {t("delete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
