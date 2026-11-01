"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  toast,
} from "@agenticx/ui";
import { ChevronDown, ChevronRight, Layers, Plus, RefreshCcw } from "lucide-react";
import { useTranslations } from "next-intl";

import { adminFetch } from "../../lib/admin-client-auth";
import {
  createPlatformCatalogItem,
  createPlatformCatalogVersion,
  grantPlatformCatalogToTenant,
  listPlatformCatalogItems,
  listPlatformCatalogVersions,
  loadPlatformCatalogDetail,
  publishPlatformCatalogVersion,
  revokePlatformCatalogFromTenant,
  scanPlatformCatalogVersion,
  type CatalogGrantRow,
  type CatalogItemRow,
  type CatalogVersionRow,
} from "./platform-catalog-client";

export function PlatformCatalogPanel() {
  const t = useTranslations("pages.admin.capabilityPacks.ecp");
  const tPack = useTranslations("pages.admin.capabilityPacks");
  const tc = useTranslations("common");
  const [items, setItems] = useState<CatalogItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [grants, setGrants] = useState<CatalogGrantRow[]>([]);
  const [versions, setVersions] = useState<CatalogVersionRow[]>([]);
  const [grantTenantId, setGrantTenantId] = useState("");
  const [newVersion, setNewVersion] = useState("");

  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [resourceType, setResourceType] = useState<"skill" | "expert_package">("skill");
  const [bundleUri, setBundleUri] = useState("");
  const [packManifestJson, setPackManifestJson] = useState('{\n  "members": []\n}');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listPlatformCatalogItems(adminFetch, tc("states.error"));
      setItems(rows);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("states.error"));
    } finally {
      setLoading(false);
    }
  }, [tc]);

  const loadExpanded = useCallback(
    async (catalogId: string) => {
      setDetailLoading(true);
      try {
        const [detail, versionRows] = await Promise.all([
          loadPlatformCatalogDetail(adminFetch, catalogId, tc("states.error")),
          listPlatformCatalogVersions(adminFetch, catalogId, tc("states.error")),
        ]);
        setGrants(detail.grants);
        setVersions(versionRows);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : tc("states.error"));
      } finally {
        setDetailLoading(false);
      }
    },
    [tc],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (expandedId) void loadExpanded(expandedId);
  }, [expandedId, loadExpanded]);

  async function onCreate() {
    if (!slug.trim()) {
      toast.error(t("platformCatalog.slugRequired"));
      return;
    }
    let packManifest: Record<string, unknown> | undefined;
    if (resourceType === "expert_package") {
      try {
        const parsed = JSON.parse(packManifestJson) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error(t("platformCatalog.manifestInvalid"));
        }
        packManifest = parsed as Record<string, unknown>;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("platformCatalog.manifestInvalid"));
        return;
      }
    }
    setCreating(true);
    try {
      await createPlatformCatalogItem(
        adminFetch,
        {
          slug: slug.trim(),
          displayName: displayName.trim() || undefined,
          resourceType,
          bundleUri: bundleUri.trim() || undefined,
          packManifest,
        },
        tc("states.error"),
      );
      toast.success(t("platformCatalog.created"));
      setSlug("");
      setDisplayName("");
      setBundleUri("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("states.error"));
    } finally {
      setCreating(false);
    }
  }

  async function runVersionAction(
    catalogId: string,
    versionId: string,
    action: "scan" | "publish",
  ) {
    try {
      if (action === "scan") {
        await scanPlatformCatalogVersion(adminFetch, catalogId, versionId, tc("states.error"));
        toast.success(t("platformCatalog.scanDone"));
      } else {
        await publishPlatformCatalogVersion(adminFetch, catalogId, versionId, tc("states.error"));
        toast.success(tPack("shelf.publish"));
      }
      await load();
      if (expandedId === catalogId) await loadExpanded(catalogId);
    } catch (error) {
      const message = error instanceof Error ? error.message : tc("states.error");
      if (action === "publish" && /approval|审核/i.test(message)) {
        toast.error(tPack("approval.publishBlocked"));
        return;
      }
      toast.error(message);
    }
  }

  async function onGrant(catalogId: string) {
    if (!grantTenantId.trim()) {
      toast.error(t("platformCatalog.tenantRequired"));
      return;
    }
    try {
      await grantPlatformCatalogToTenant(
        adminFetch,
        catalogId,
        grantTenantId,
        tc("states.error"),
      );
      toast.success(t("platformCatalog.grantDone"));
      setGrantTenantId("");
      await loadExpanded(catalogId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("states.error"));
    }
  }

  async function onRevoke(catalogId: string, tenantId: string) {
    try {
      await revokePlatformCatalogFromTenant(
        adminFetch,
        catalogId,
        tenantId,
        "retain_stop_updates",
        tc("states.error"),
      );
      toast.success(t("platformCatalog.revokeDone"));
      await loadExpanded(catalogId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("states.error"));
    }
  }

  async function onAddVersion(catalogId: string) {
    if (!newVersion.trim()) {
      toast.error(t("platformCatalog.versionRequired"));
      return;
    }
    try {
      await createPlatformCatalogVersion(
        adminFetch,
        catalogId,
        { version: newVersion.trim(), bundleUri: bundleUri.trim() || undefined },
        tc("states.error"),
      );
      toast.success(t("platformCatalog.versionCreated"));
      setNewVersion("");
      await loadExpanded(catalogId);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("states.error"));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="size-4" /> {t("platformCatalog.title")}
        </CardTitle>
        <CardDescription>{t("platformCatalog.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3 rounded-lg border p-4">
          <div className="text-sm font-medium">{t("platformCatalog.createTitle")}</div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="catalog-slug">{t("platformCatalog.slug")}</Label>
              <Input
                id="catalog-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="research-pack"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="catalog-name">{t("platformCatalog.displayName")}</Label>
              <Input
                id="catalog-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("platformCatalog.resourceTypeLabel")}</Label>
              <Select
                value={resourceType}
                onValueChange={(v) => setResourceType(v as "skill" | "expert_package")}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skill">{t("resourceType.skill")}</SelectItem>
                  <SelectItem value="expert_package">{t("resourceType.expert_package")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[220px] flex-1 space-y-1">
              <Label htmlFor="catalog-bundle">{t("platformCatalog.bundleUri")}</Label>
              <Input
                id="catalog-bundle"
                value={bundleUri}
                onChange={(e) => setBundleUri(e.target.value)}
                placeholder="https://"
              />
            </div>
            <Button onClick={() => void onCreate()} disabled={creating}>
              <Plus className="mr-1 size-4" /> {tc("actions.create")}
            </Button>
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCcw className="mr-1 size-4" /> {tc("actions.refresh")}
            </Button>
          </div>
          {resourceType === "expert_package" && (
            <div className="space-y-1">
              <Label htmlFor="catalog-manifest">{t("platformCatalog.packManifest")}</Label>
              <Textarea
                id="catalog-manifest"
                className="min-h-[120px] font-mono text-xs"
                value={packManifestJson}
                onChange={(e) => setPackManifestJson(e.target.value)}
              />
            </div>
          )}
        </div>

        {loading && <p className="text-sm text-muted-foreground">{tc("states.loading")}</p>}
        {!loading && items.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("platformCatalog.empty")}</p>
        )}
        {!loading &&
          items.map((item) => {
            const open = expandedId === item.id;
            return (
              <div key={item.id} className="rounded-lg border">
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left"
                  onClick={() => setExpandedId(open ? null : item.id)}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {open ? (
                      <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <div>
                      <div className="font-medium">{item.displayName || item.slug}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.slug} · {item.version}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">
                      {item.resourceType === "expert_package"
                        ? t("resourceType.expert_package")
                        : t("resourceType.skill")}
                    </Badge>
                    <Badge variant={item.shelfStatus === "published" ? "success" : "secondary"}>
                      {item.shelfStatus === "published"
                        ? tPack("shelf.published")
                        : tPack("shelf.draft")}
                    </Badge>
                  </div>
                </button>
                {open && (
                  <div className="space-y-4 border-t p-3">
                    {detailLoading && (
                      <p className="text-sm text-muted-foreground">{tc("states.loading")}</p>
                    )}
                    {!detailLoading && (
                      <>
                        <div className="space-y-2">
                          <div className="text-sm font-medium">{t("platformCatalog.versionsTitle")}</div>
                          {versions.length === 0 && (
                            <p className="text-xs text-muted-foreground">{t("platformCatalog.noVersions")}</p>
                          )}
                          {versions.map((ver) => (
                            <div
                              key={ver.id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2"
                            >
                              <div className="text-sm">
                                <span className="font-medium">{ver.version}</span>
                                <span className="ml-2 text-xs text-muted-foreground">{ver.shelfStatus}</span>
                                {ver.scanVerdict ? (
                                  <Badge className="ml-2" variant="secondary">
                                    {ver.scanVerdict}
                                  </Badge>
                                ) : (
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    {tPack("skills.scanNever")}
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={ver.shelfStatus === "published"}
                                  onClick={() => void runVersionAction(item.id, ver.id, "scan")}
                                >
                                  {tPack("skills.scan")}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={ver.shelfStatus === "published"}
                                  onClick={() => void runVersionAction(item.id, ver.id, "publish")}
                                >
                                  {tPack("shelf.publish")}
                                </Button>
                              </div>
                            </div>
                          ))}
                          <div className="flex flex-wrap items-end gap-2 pt-1">
                            <div className="space-y-1">
                              <Label htmlFor={`ver-${item.id}`}>{t("platformCatalog.newVersion")}</Label>
                              <Input
                                id={`ver-${item.id}`}
                                value={expandedId === item.id ? newVersion : ""}
                                onChange={(e) => setNewVersion(e.target.value)}
                                placeholder="1.0.1"
                                className="w-32"
                              />
                            </div>
                            <Button size="sm" variant="secondary" onClick={() => void onAddVersion(item.id)}>
                              {t("platformCatalog.addVersion")}
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="text-sm font-medium">{t("platformCatalog.grantsTitle")}</div>
                          <p className="text-xs text-muted-foreground">{t("platformCatalog.grantsHint")}</p>
                          {grants.filter((g) => g.status === "granted").length === 0 && (
                            <p className="text-xs text-muted-foreground">{t("platformCatalog.noGrants")}</p>
                          )}
                          {grants
                            .filter((g) => g.status === "granted")
                            .map((g) => (
                              <div
                                key={g.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                              >
                                <code className="text-xs">{g.tenantId}</code>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void onRevoke(item.id, g.tenantId)}
                                >
                                  {t("platformCatalog.revoke")}
                                </Button>
                              </div>
                            ))}
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="min-w-[280px] flex-1 space-y-1">
                              <Label htmlFor={`grant-${item.id}`}>{t("platformCatalog.tenantId")}</Label>
                              <Input
                                id={`grant-${item.id}`}
                                value={grantTenantId}
                                onChange={(e) => setGrantTenantId(e.target.value)}
                                placeholder="01TENANT..."
                              />
                            </div>
                            <Button size="sm" onClick={() => void onGrant(item.id)}>
                              {t("platformCatalog.grant")}
                            </Button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
      </CardContent>
    </Card>
  );
}

export function EcpDistributionSettingsPanel() {
  const t = useTranslations("pages.admin.capabilityPacks.ecp");
  const tc = useTranslations("common");
  const [installCopyEnabled, setInstallCopyEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await adminFetch("/api/admin/ecp/distribution-settings");
        const json = (await res.json()) as {
          data?: { policy?: { installCopyEnabled?: boolean } };
          message?: string;
        };
        if (!res.ok) throw new Error(json.message || tc("states.error"));
        if (!cancelled) setInstallCopyEnabled(json.data?.policy?.installCopyEnabled === true);
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : tc("states.error"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tc]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("distribution.title")}</CardTitle>
        <CardDescription>{t("distribution.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="font-medium">{t("distribution.installCopyLabel")}</div>
          <p className="text-sm text-muted-foreground">{t("distribution.installCopyHint")}</p>
        </div>
        <Switch
          checked={installCopyEnabled}
          disabled={loading || saving}
          onCheckedChange={async (checked) => {
            setSaving(true);
            try {
              const res = await adminFetch("/api/admin/ecp/distribution-settings", {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ installCopyEnabled: checked }),
              });
              const json = (await res.json()) as { message?: string };
              if (!res.ok) throw new Error(json.message || tc("states.error"));
              setInstallCopyEnabled(checked);
              toast.success(t("distribution.saved"));
            } catch (error) {
              toast.error(error instanceof Error ? error.message : tc("states.error"));
            } finally {
              setSaving(false);
            }
          }}
        />
      </CardContent>
    </Card>
  );
}
