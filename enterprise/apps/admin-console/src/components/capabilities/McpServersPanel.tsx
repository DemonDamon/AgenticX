"use client";

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@agenticx/ui";
import { Plug } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { useCapabilityCatalog } from "./use-capability-catalog";

export function McpServersPanel() {
  const t = useTranslations("pages.admin.capabilities");
  const tc = useTranslations("common");
  const catalog = useCapabilityCatalog(t("mcp.loadFailed"), tc("states.error"));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="size-4" /> {t("mcp.title")}
        </CardTitle>
        <CardDescription>{t("mcp.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {catalog.loading && <p className="text-sm text-muted-foreground">{tc("states.loading")}</p>}
        {!catalog.loading && catalog.mcpServers.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("mcp.empty")}</p>
        )}
        {catalog.mcpServers.map((server) => (
          <div
            key={server.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
          >
            <div>
              <div className="font-medium">{server.displayName || server.name}</div>
              <div className="text-xs text-muted-foreground">{server.name}</div>
            </div>
            <Badge variant={server.status === "active" ? "default" : "secondary"}>
              {server.status === "active" ? t("mcp.active") : t("mcp.disabled")}
            </Badge>
          </div>
        ))}
        <Button asChild variant="outline">
          <Link href="/admin/mcp-servers">{t("mcp.manage")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
