"use client";
import { adminFetch } from "../../../lib/admin-client-auth";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  PageHeader,
  Textarea,
  toast,
} from "@agenticx/ui";
import { Cable, RefreshCcw, Trash2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";

type ConnectorRow = {
  id: string;
  displayName: string;
  description?: string;
  authType: string;
  actionCount: number;
};

type ConnectionRow = {
  id: string;
  connectorId: string;
  name: string;
  authType: string;
  grantedScopes: string[];
  status: string;
  createdAt: string;
};

export default function AdminConnectorsSection() {
  const t = useTranslations("pages.admin.connectors");
  const tc = useTranslations("common");
  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);

  // 导入表单
  const [importId, setImportId] = useState("");
  const [importName, setImportName] = useState("");
  const [importBase, setImportBase] = useState("");
  const [importSpec, setImportSpec] = useState("");
  const [confirmDestructive, setConfirmDestructive] = useState(false);
  const [pendingDestructive, setPendingDestructive] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  // 新建连接表单
  const [connName, setConnName] = useState("");
  const [connScopes, setConnScopes] = useState("");
  const [connKey, setConnKey] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/connectors");
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "load failed");
      setConnectors(json.data?.connectors ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadConnections = useCallback(async (connectorId: string) => {
    setConnectionsLoading(true);
    try {
      const res = await adminFetch(`/api/admin/connectors/${encodeURIComponent(connectorId)}/connections`);
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "load failed");
      setConnections(json.data?.connections ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.loadConnectionsFailed"));
    } finally {
      setConnectionsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (selectedId) void loadConnections(selectedId);
    else setConnections([]);
  }, [selectedId, loadConnections]);

  async function submitImport() {
    if (!importId.trim() || !importSpec.trim()) {
      toast.error(t("toast.importRequired"));
      return;
    }
    let spec: unknown;
    try {
      spec = JSON.parse(importSpec);
    } catch {
      toast.error(t("toast.specInvalid"));
      return;
    }
    setImporting(true);
    try {
      const res = await adminFetch("/api/admin/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectorId: importId.trim(),
          displayName: importName.trim() || undefined,
          baseUrl: importBase.trim() || undefined,
          spec,
          confirmDestructive,
        }),
      });
      const json = await res.json();
      if (json.code === "40901") {
        // destructive 待确认：展示列表，需勾选确认后重试
        setPendingDestructive(json.data?.destructive ?? []);
        toast.error(t("toast.needsConfirm"));
        return;
      }
      if (json.code !== "00000") throw new Error(json.message || "import failed");
      toast.success(t("toast.importSuccess", { count: json.data?.connector?.actionCount ?? 0 }));
      setPendingDestructive([]);
      setConfirmDestructive(false);
      setImportId("");
      setImportName("");
      setImportBase("");
      setImportSpec("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.importFailed"));
    } finally {
      setImporting(false);
    }
  }

  async function deleteConnector(id: string) {
    try {
      const res = await adminFetch(`/api/admin/connectors/${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "delete failed");
      toast.success(t("toast.deleteSuccess"));
      if (selectedId === id) setSelectedId(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.deleteFailed"));
    }
  }

  async function createConnection() {
    if (!selectedId || !connName.trim()) {
      toast.error(t("toast.connectionNameRequired"));
      return;
    }
    try {
      const res = await adminFetch(`/api/admin/connectors/${encodeURIComponent(selectedId)}/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: connName.trim(),
          grantedScopes: connScopes.split(",").map((s) => s.trim()).filter(Boolean),
          apiKey: connKey.trim(),
        }),
      });
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "create failed");
      toast.success(t("toast.connectionCreated"));
      setConnName("");
      setConnScopes("");
      setConnKey("");
      await loadConnections(selectedId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.connectionCreateFailed"));
    }
  }

  async function connectionAction(connectionId: string, action: "rotate" | "revoke") {
    if (!selectedId) return;
    let apiKey = "";
    if (action === "rotate") {
      apiKey = window.prompt(t("rotatePrompt")) ?? "";
      if (!apiKey.trim()) return;
    }
    try {
      const res = await adminFetch(
        `/api/admin/connectors/${encodeURIComponent(selectedId)}/connections/${encodeURIComponent(connectionId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, apiKey }),
        }
      );
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "operation failed");
      toast.success(action === "rotate" ? t("toast.rotateSuccess") : t("toast.revokeSuccess"));
      await loadConnections(selectedId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.operationFailed"));
    }
  }

  const selected = connectors.find((c) => c.id === selectedId);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            {tc("actions.refresh")}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cable className="h-4 w-4" />
            {t("connectorList")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">{tc("states.loading")}</p>
          ) : connectors.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("emptyConnectors")}</p>
          ) : (
            connectors.map((c) => (
              <div
                key={c.id}
                className={`flex items-center justify-between rounded-md border px-3 py-2 cursor-pointer ${
                  selectedId === c.id ? "border-primary bg-primary/5" : ""
                }`}
                onClick={() => setSelectedId(c.id === selectedId ? null : c.id)}
              >
                <div>
                  <div className="font-medium">
                    {c.displayName} <span className="text-xs text-muted-foreground">({c.id})</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("authType")}: {c.authType} · {t("actionCount", { count: c.actionCount })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={c.authType === "api_key" ? "default" : "secondary"}>{c.authType}</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteConnector(c.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("importTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submitImport();
            }}
          >
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="connector-id">{t("connectorId")}</Label>
                <Input
                  id="connector-id"
                  value={importId}
                  onChange={(e) => setImportId(e.target.value)}
                  placeholder="tickets"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="connector-name">{t("displayName")}</Label>
                <Input
                  id="connector-name"
                  value={importName}
                  onChange={(e) => setImportName(e.target.value)}
                  placeholder={t("displayNamePlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="connector-base">{t("baseUrlOverride")}</Label>
                <Input
                  id="connector-base"
                  value={importBase}
                  onChange={(e) => setImportBase(e.target.value)}
                  placeholder="https://proxy.internal.example.com"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="connector-spec">{t("openapiSpec")}</Label>
              <Textarea
                id="connector-spec"
                rows={8}
                value={importSpec}
                onChange={(e) => setImportSpec(e.target.value)}
                placeholder='{ "openapi": "3.0.3", ... }'
                className="font-mono text-xs"
              />
            </div>
            {pendingDestructive.length > 0 && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
                <div className="font-medium text-destructive">{t("destructiveWarning")}</div>
                <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                  {pendingDestructive.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
            {pendingDestructive.length > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmDestructive}
                  onChange={(e) => setConfirmDestructive(e.target.checked)}
                />
                {t("confirmDestructive")}
              </label>
            )}
            <Button type="submit" disabled={importing}>
              <Upload className="mr-2 h-4 w-4" />
              {importing ? tc("states.loading") : t("importSubmit")}
            </Button>
          </form>
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("connectionsTitle", { name: selected.displayName })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {connectionsLoading ? (
              <p className="text-sm text-muted-foreground">{tc("states.loading")}</p>
            ) : connections.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("emptyConnections")}</p>
            ) : (
              connections.map((conn) => (
                <div key={conn.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div>
                    <div className="font-medium">{conn.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {conn.id} · {conn.authType}
                      {(conn.grantedScopes ?? []).length > 0 &&
                        ` · scopes: ${(conn.grantedScopes ?? []).join(", ")}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={conn.status === "active" ? "default" : "secondary"}>{conn.status}</Badge>
                    {conn.status === "active" && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => void connectionAction(conn.id, "rotate")}>
                          {t("rotate")}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void connectionAction(conn.id, "revoke")}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}

            <form
              className="space-y-4 border-t pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                void createConnection();
              }}
            >
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="conn-name">{t("connectionName")}</Label>
                  <Input id="conn-name" value={connName} onChange={(e) => setConnName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="conn-scopes">{t("grantedScopes")}</Label>
                  <Input
                    id="conn-scopes"
                    value={connScopes}
                    onChange={(e) => setConnScopes(e.target.value)}
                    placeholder="read, write"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="conn-key">{t("apiKey")}</Label>
                  <Input
                    id="conn-key"
                    type="password"
                    value={connKey}
                    onChange={(e) => setConnKey(e.target.value)}
                    placeholder={selected.authType === "api_key" ? t("apiKeyRequired") : t("apiKeyNone")}
                  />
                </div>
              </div>
              <Button type="submit">{t("createConnection")}</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
