"use client";

import { adminFetch } from "../../../lib/admin-client-auth";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, CardContent, EmptyState, toast } from "@agenticx/ui";
import { Activity, RefreshCcw } from "lucide-react";
import { useTranslations } from "next-intl";

type ReplicaStatus = "applied" | "pending" | "offline";

type ReplicaDomain = {
  domain: "providers" | "channels" | "policy" | "mcp_servers";
  appliedAt: string;
  version: string;
  lastError: string;
  contentHash: string;
};

type Replica = {
  instanceId: string;
  lastSeenAt: string;
  status: ReplicaStatus;
  domains: ReplicaDomain[];
};

const DOMAIN_ORDER = ["providers", "channels", "policy", "mcp_servers"] as const;

function domainLabel(domain: (typeof DOMAIN_ORDER)[number], t: (key: string) => string): string {
  switch (domain) {
    case "providers":
      return t("domainProviders");
    case "channels":
      return t("domainChannels");
    case "policy":
      return t("domainPolicy");
    case "mcp_servers":
      return t("domainMcp");
    default: {
      const unreachable: never = domain;
      return unreachable;
    }
  }
}

function statusLabel(status: ReplicaStatus, t: (key: string) => string): string {
  switch (status) {
    case "applied":
      return t("statusApplied");
    case "pending":
      return t("statusPending");
    case "offline":
      return t("statusOffline");
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

function statusVariant(status: ReplicaStatus): "success" | "warning" | "soft" {
  switch (status) {
    case "applied":
      return "success";
    case "pending":
      return "warning";
    case "offline":
      return "soft";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

function formatTime(value: string, empty: string): string {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return empty;
  return date.toLocaleString();
}

export function GatewayReplicas() {
  const t = useTranslations("pages.admin.channels.replicas");
  const tc = useTranslations("common");
  const [loading, setLoading] = useState(true);
  const [publishedPolicyVersion, setPublishedPolicyVersion] = useState("");
  const [instances, setInstances] = useState<Replica[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/gateway-instances", { cache: "no-store" });
      const json = (await res.json()) as {
        code?: string;
        message?: string;
        data?: { publishedPolicyVersion?: string; instances?: Replica[] };
      };
      if (!res.ok || json.code !== "00000") {
        toast.error(json.message || t("loadFailed"));
        return;
      }
      setPublishedPolicyVersion(json.data?.publishedPolicyVersion ?? "");
      setInstances(Array.isArray(json.data?.instances) ? json.data.instances : []);
    } catch {
      toast.error(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCcw className="mr-1 h-4 w-4" /> {tc("actions.refresh")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("publishedVersion")}：{publishedPolicyVersion || t("unpublished")}
      </p>
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : instances.length === 0 ? (
        <EmptyState icon={<Activity className="h-5 w-5" />} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {instances.map((instance) => (
            <Card key={instance.instanceId} className={instance.status === "offline" ? "opacity-60" : undefined}>
              <CardContent className="space-y-3 pt-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{instance.instanceId}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("lastSeen")}：{formatTime(instance.lastSeenAt, t("emptyValue"))}
                    </p>
                  </div>
                  <Badge variant={statusVariant(instance.status)}>{statusLabel(instance.status, t)}</Badge>
                </div>
                <div className="space-y-2 text-xs text-muted-foreground">
                  {DOMAIN_ORDER.map((domain) => {
                    const item = instance.domains.find((entry) => entry.domain === domain);
                    return (
                      <div key={domain}>
                        <p className="text-foreground">{domainLabel(domain, t)}</p>
                        <p>
                          {t("appliedAt")}：{formatTime(item?.appliedAt ?? "", t("emptyValue"))}
                        </p>
                        <p>
                          {t("version")}：{item?.version || t("emptyValue")}
                        </p>
                        <p className={item?.lastError ? "text-destructive" : undefined}>
                          {t("error")}：{item?.lastError || t("emptyValue")}
                        </p>
                        {item?.contentHash ? (
                          <p>
                            {t("summary")}：{item.contentHash.slice(0, 12)}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
