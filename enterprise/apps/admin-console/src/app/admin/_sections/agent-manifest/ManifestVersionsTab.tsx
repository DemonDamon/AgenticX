"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";

import { adminFetch } from "../../../../lib/admin-client-auth";
import { ManifestDiffView } from "./ManifestDiffView";

export type VersionRow = {
  version: number;
  manifest: Record<string, unknown>;
  note: string | null;
  source: string;
  createdBy: string | null;
  createdAt: string;
};

type ManifestVersionsTabProps = {
  agentId: string;
  versions: VersionRow[];
  latestVersion: number;
  effectiveVersion: number;
  onEditFrom: (version: VersionRow) => void;
  onChanged: () => void;
};

type VersionSource = "backfill" | "admin" | "api" | "legacy_edit" | "desktop";

function isVersionSource(value: string): value is VersionSource {
  return value === "backfill" || value === "admin" || value === "api" || value === "legacy_edit" || value === "desktop";
}

function previousVersion(versions: VersionRow[], version: number): number {
  const lower = versions.filter((item) => item.version < version).map((item) => item.version);
  if (lower.length === 0) return version;
  return Math.max(...lower);
}

export function ManifestVersionsTab({
  agentId,
  versions,
  latestVersion,
  effectiveVersion,
  onEditFrom,
  onChanged,
}: ManifestVersionsTabProps) {
  const t = useTranslations("pages.admin.agents");
  const tc = useTranslations("common");
  const [viewing, setViewing] = useState<VersionRow | null>(null);
  const [comparing, setComparing] = useState<VersionRow | null>(null);
  const [pendingPin, setPendingPin] = useState<VersionRow | null>(null);
  const [pinning, setPinning] = useState(false);

  function sourceLabel(source: string): string {
    if (!isVersionSource(source)) return source;
    switch (source) {
      case "backfill":
        return t("manifest.source.backfill");
      case "admin":
        return t("manifest.source.admin");
      case "api":
        return t("manifest.source.api");
      case "legacy_edit":
        return t("manifest.source.legacy_edit");
      case "desktop":
        return t("manifest.source.desktop");
      default: {
        const unreachable: never = source;
        return unreachable;
      }
    }
  }

  async function confirmPin() {
    if (!pendingPin || pinning) return;
    setPinning(true);
    try {
      const res = await adminFetch(`/api/admin/agents/${agentId}/ma-settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionRouting: "pinned", pinnedVersion: pendingPin.version }),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        toast.error(json.message || tc("toast.saveFailed"));
        return;
      }
      toast.success(t("routing.saved"));
      setPendingPin(null);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("toast.saveFailed"));
    } finally {
      setPinning(false);
    }
  }

  if (versions.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("manifest.versions.empty")}</p>;
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("manifest.versions.version")}</TableHead>
            <TableHead>{t("manifest.versions.source")}</TableHead>
            <TableHead>{t("manifest.versions.note")}</TableHead>
            <TableHead>{t("manifest.versions.createdBy")}</TableHead>
            <TableHead>{t("manifest.versions.createdAt")}</TableHead>
            <TableHead>{t("columns.status")}</TableHead>
            <TableHead>{t("columns.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {versions.map((version) => (
            <TableRow key={version.version}>
              <TableCell>v{version.version}</TableCell>
              <TableCell>{sourceLabel(version.source)}</TableCell>
              <TableCell className="max-w-[180px] truncate">{version.note || "—"}</TableCell>
              <TableCell>{version.createdBy || t("manifest.versions.system")}</TableCell>
              <TableCell>{version.createdAt}</TableCell>
              <TableCell>
                <div className="flex gap-1">
                  {version.version === latestVersion ? <Badge>{t("manifest.versions.latest")}</Badge> : null}
                  {version.version === effectiveVersion ? <Badge variant="secondary">{t("manifest.versions.effective")}</Badge> : null}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setViewing(version)}>
                    {t("manifest.versions.view")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setComparing(version)}>
                    {t("manifest.versions.compare")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onEditFrom(version)}>
                    {t("manifest.versions.editFrom")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPendingPin(version)}>
                    {t("manifest.versions.pin")}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {viewing ? (
        <pre className="max-h-80 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs">
          {JSON.stringify(viewing.manifest, null, 2)}
        </pre>
      ) : null}
      {comparing ? (
        <ManifestDiffView
          versions={versions}
          initialFrom={previousVersion(versions, comparing.version)}
          initialTo={comparing.version}
        />
      ) : null}

      <Dialog open={pendingPin !== null} onOpenChange={(open) => !pinning && !open && setPendingPin(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("routing.pinConfirmTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("routing.pinConfirmDescription", { version: pendingPin?.version ?? 0 })}
          </p>
          <DialogFooter className="flex-row justify-end">
            <Button variant="outline" onClick={() => !pinning && setPendingPin(null)}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={() => void confirmPin()} disabled={pinning}>
              {t("routing.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
