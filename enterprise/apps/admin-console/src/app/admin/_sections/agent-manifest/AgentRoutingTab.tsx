"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";

import { adminFetch } from "../../../../lib/admin-client-auth";

type RoutingMode = "follow_latest" | "pinned";
type EnvOption = { id: string; name: string; type: string; status: string };

type AgentRoutingTabProps = {
  agentId: string;
  mode: RoutingMode;
  pinnedVersion: number | null;
  defaultEnvironmentId: string | null;
  runtime: "cloud" | "desktop_worker";
  versions: Array<{ version: number }>;
  environments: EnvOption[];
  onChanged: () => void;
};

const NONE = "__none__";

export function AgentRoutingTab({
  agentId,
  mode,
  pinnedVersion,
  defaultEnvironmentId,
  runtime,
  versions,
  environments,
  onChanged,
}: AgentRoutingTabProps) {
  const t = useTranslations("pages.admin.agents");
  const tc = useTranslations("common");
  const [nextMode, setNextMode] = useState<RoutingMode>(mode);
  const [nextPinned, setNextPinned] = useState(pinnedVersion ? String(pinnedVersion) : String(versions[0]?.version ?? ""));
  const [nextEnv, setNextEnv] = useState(defaultEnvironmentId ?? NONE);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNextMode(mode);
    setNextPinned(pinnedVersion ? String(pinnedVersion) : String(versions[0]?.version ?? ""));
    setNextEnv(defaultEnvironmentId ?? NONE);
  }, [mode, pinnedVersion, defaultEnvironmentId, versions]);

  const available = environments.filter((item) => item.status === "active" && item.type === runtime);
  const current = environments.find((item) => item.id === defaultEnvironmentId);
  const currentUnavailable = Boolean(current && !available.some((item) => item.id === current.id));

  const routingChanged =
    nextMode !== mode || (nextMode === "pinned" && Number(nextPinned) !== pinnedVersion);
  const followBack = mode === "pinned" && nextMode === "follow_latest";

  async function save() {
    if (nextMode === "pinned" && !/^[1-9]\d{0,8}$/.test(nextPinned)) {
      toast.error(t("routing.pinnedVersion"));
      return;
    }
    setSaving(true);
    try {
      const res = await adminFetch(`/api/admin/agents/${agentId}/ma-settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          versionRouting: nextMode,
          pinnedVersion: nextMode === "pinned" ? Number(nextPinned) : null,
          defaultEnvironmentId: nextEnv === NONE ? null : nextEnv,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        toast.error(json.message || tc("toast.saveFailed"));
        return;
      }
      toast.success(t("routing.saved"));
      setConfirmOpen(false);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("toast.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>{t("routing.mode")}</Label>
        <Select
          value={nextMode}
          onValueChange={(value) => {
            if (value === "follow_latest" || value === "pinned") {
              setNextMode(value);
              if (value === "pinned" && !nextPinned && versions[0]) setNextPinned(String(versions[0].version));
            }
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="follow_latest">{t("routing.followLatest")}</SelectItem>
            <SelectItem value="pinned">{t("routing.pinned")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {nextMode === "pinned" ? (
        <div className="space-y-1">
          <Label>{t("routing.pinnedVersion")}</Label>
          <Select value={nextPinned || undefined} onValueChange={setNextPinned}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {versions.map((item) => (
                <SelectItem key={item.version} value={String(item.version)}>
                  v{item.version}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="space-y-1">
        <Label>{t("routing.defaultEnvironment")}</Label>
        <Select value={nextEnv} onValueChange={setNextEnv}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("routing.noEnvironment")}</SelectItem>
            {currentUnavailable && current ? (
              <SelectItem value={current.id}>{t("routing.unavailableName", { name: current.name })}</SelectItem>
            ) : null}
            {available.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {currentUnavailable ? <Alert variant="warning">{t("routing.envUnavailable")}</Alert> : null}
      <div className="flex justify-end">
        <Button
          onClick={() => {
            if (routingChanged) {
              setConfirmOpen(true);
              return;
            }
            void save();
          }}
          disabled={saving}
        >
          {t("routing.save")}
        </Button>
      </div>
      <Dialog open={confirmOpen} onOpenChange={(open) => !saving && setConfirmOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("routing.pinConfirmTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {followBack
              ? t("routing.followConfirmDescription")
              : t("routing.pinConfirmDescription", { version: Number(nextPinned) || 0 })}
          </p>
          <DialogFooter className="flex-row justify-end">
            <Button variant="outline" onClick={() => !saving && setConfirmOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {t("routing.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
