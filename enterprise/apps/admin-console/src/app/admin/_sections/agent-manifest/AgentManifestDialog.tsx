"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";

import { adminFetch } from "../../../../lib/admin-client-auth";
import { AgentRoutingTab } from "./AgentRoutingTab";
import { ManifestFormTab } from "./ManifestFormTab";
import { ManifestJsonTab } from "./ManifestJsonTab";
import { ManifestVersionsTab, type VersionRow } from "./ManifestVersionsTab";

type AgentWithMa = {
  id: string;
  model: string;
  systemPrompt: string;
  latestVersion?: number;
  effectiveVersion?: number;
  versionRouting?: "follow_latest" | "pinned";
  pinnedVersion?: number | null;
  defaultEnvironmentId?: string | null;
};

type SkillOption = { id: string; slug: string; displayName: string; version: string; status: string };
type EnvOption = { id: string; name: string; type: "cloud" | "desktop_worker"; status: string };
type TabId = "form" | "json" | "versions" | "routing";

type AgentManifestDialogProps = {
  agentId: string;
  agentName: string;
  runtime: "cloud" | "desktop_worker";
  models: Array<{ id: string; label: string }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
};

const EMPTY_MANIFEST: Record<string, unknown> = { schema: "agx.agent/v1", model: "", system: "" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepClone(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function isTab(value: string): value is TabId {
  return value === "form" || value === "json" || value === "versions" || value === "routing";
}

function asVersion(value: unknown): VersionRow | null {
  if (!isRecord(value) || typeof value.version !== "number" || !isRecord(value.manifest)) return null;
  return {
    version: value.version,
    manifest: value.manifest,
    note: typeof value.note === "string" ? value.note : null,
    source: typeof value.source === "string" ? value.source : "admin",
    createdBy: typeof value.createdBy === "string" ? value.createdBy : null,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
  };
}

export function AgentManifestDialog({
  agentId,
  agentName,
  runtime,
  models,
  open,
  onOpenChange,
  onChanged,
}: AgentManifestDialogProps) {
  const t = useTranslations("pages.admin.agents");
  const tc = useTranslations("common");
  const [agent, setAgent] = useState<AgentWithMa | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown>>(EMPTY_MANIFEST);
  const [revision, setRevision] = useState(0);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<TabId>("form");
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [environments, setEnvironments] = useState<EnvOption[]>([]);

  const applySnapshot = useCallback((nextAgent: AgentWithMa | null, nextVersions: VersionRow[], resetDraft: boolean) => {
    setAgent(nextAgent);
    setVersions(nextVersions);
    if (!resetDraft) return;
    const latestNumber = nextAgent?.latestVersion;
    const latest = nextVersions.find((item) => item.version === latestNumber) ?? nextVersions[0];
    setDraft(latest ? deepClone(latest.manifest) : { ...EMPTY_MANIFEST });
    setRevision((value) => value + 1);
    setNote("");
    setErrors([]);
  }, []);

  const load = useCallback(
    async (resetDraft: boolean) => {
      const [versionsRes, skillsRes, envRes] = await Promise.all([
        adminFetch(`/api/admin/agents/${agentId}/versions?limit=50`, { cache: "no-store" }),
        adminFetch("/api/admin/skills", { cache: "no-store" }),
        adminFetch("/api/admin/ma-environments", { cache: "no-store" }),
      ]);
      const versionsJson = (await versionsRes.json().catch(() => ({}))) as {
        message?: string;
        data?: { agent?: AgentWithMa; versions?: unknown[] };
      };
      if (!versionsRes.ok) throw new Error(versionsJson.message || tc("toast.loadFailed"));
      const skillsJson = (await skillsRes.json().catch(() => ({}))) as { data?: { skills?: SkillOption[] } };
      const envJson = (await envRes.json().catch(() => ({}))) as {
        data?: { environments?: EnvOption[] };
      };
      setSkills(skillsJson.data?.skills ?? []);
      setEnvironments(
        (envJson.data?.environments ?? []).filter(
          (item): item is EnvOption => item.type === "cloud" || item.type === "desktop_worker",
        ),
      );
      const rows = (versionsJson.data?.versions ?? []).map(asVersion).filter((item): item is VersionRow => item !== null);
      applySnapshot(versionsJson.data?.agent ?? null, rows, resetDraft);
    },
    [agentId, applySnapshot, tc],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void load(true).catch((error: unknown) => {
      if (cancelled) return;
      toast.error(error instanceof Error ? error.message : tc("toast.loadFailed"));
    });
    return () => {
      cancelled = true;
    };
  }, [open, load, tc]);

  const latest = versions.find((item) => item.version === agent?.latestVersion) ?? versions[0];
  const manifestModel = typeof latest?.manifest.model === "string" ? latest.manifest.model : "";
  const manifestSystem = typeof latest?.manifest.system === "string" ? latest.manifest.system : "";
  const drifted = Boolean(
    agent && latest && (manifestModel !== agent.model || manifestSystem !== (agent.systemPrompt ?? "")),
  );

  async function validate() {
    setSaving(true);
    try {
      const res = await adminFetch(`/api/admin/agents/${agentId}/versions?dryRun=1`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest: draft }),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: string; data?: { errors?: string[] } };
      if (!res.ok) {
        setErrors(json.data?.errors ?? [json.message || tc("toast.saveFailed")]);
        return;
      }
      setErrors([]);
      toast.success(t("manifest.validateOk"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("toast.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const res = await adminFetch(`/api/admin/agents/${agentId}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest: draft, expectedLatestVersion: agent?.latestVersion, note }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        message?: string;
        data?: { created?: boolean; errors?: string[]; version?: { version?: number } };
      };
      if (res.status === 409) {
        toast.error(t("manifest.conflict"));
        await load(false);
        return;
      }
      if (!res.ok) {
        setErrors(json.data?.errors ?? [json.message || tc("toast.saveFailed")]);
        return;
      }
      if (json.data?.created === false) {
        toast(t("manifest.unchanged"));
        return;
      }
      toast.success(t("manifest.saved", { version: json.data?.version?.version ?? "" }));
      setErrors([]);
      await load(true);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("toast.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("manifest.title", { name: agentName })}</DialogTitle>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (isTab(value)) setTab(value);
          }}
        >
          <TabsList>
            <TabsTrigger value="form">{t("manifest.tabs.form")}</TabsTrigger>
            <TabsTrigger value="json">{t("manifest.tabs.json")}</TabsTrigger>
            <TabsTrigger value="versions">{t("manifest.tabs.versions")}</TabsTrigger>
            <TabsTrigger value="routing">{t("manifest.tabs.routing")}</TabsTrigger>
          </TabsList>
          <TabsContent value="form" className="pt-4">
            <ManifestFormTab
              draft={draft}
              revision={revision}
              models={models}
              skills={skills}
              onDraft={(next) => setDraft(next)}
            />
          </TabsContent>
          <TabsContent value="json" className="pt-4">
            <ManifestJsonTab
              draft={draft}
              onApply={(next) => {
                setDraft(next);
                setRevision((value) => value + 1);
              }}
            />
          </TabsContent>
          <TabsContent value="versions" className="pt-4">
            <ManifestVersionsTab
              agentId={agentId}
              versions={versions}
              latestVersion={agent?.latestVersion ?? 0}
              effectiveVersion={agent?.effectiveVersion ?? 0}
              onEditFrom={(version) => {
                setDraft(deepClone(version.manifest));
                setNote(t("manifest.rollbackNote", { version: version.version }));
                setRevision((value) => value + 1);
                setTab("form");
              }}
              onChanged={() => {
                void load(false);
                onChanged();
              }}
            />
          </TabsContent>
          <TabsContent value="routing" className="pt-4">
            <AgentRoutingTab
              agentId={agentId}
              mode={agent?.versionRouting === "pinned" ? "pinned" : "follow_latest"}
              pinnedVersion={agent?.pinnedVersion ?? null}
              defaultEnvironmentId={agent?.defaultEnvironmentId ?? null}
              runtime={runtime}
              versions={versions}
              environments={environments}
              onChanged={() => {
                void load(false);
                onChanged();
              }}
            />
          </TabsContent>
        </Tabs>
        {tab === "form" || tab === "json" ? (
          <div className="space-y-3 border-t pt-3">
            {drifted ? <Alert variant="warning">{t("manifest.driftWarning")}</Alert> : null}
            {errors.length > 0 ? (
              <div className="space-y-1">
                {errors.map((error) => (
                  <p key={error} className="font-mono text-sm text-destructive">
                    {error}
                  </p>
                ))}
              </div>
            ) : null}
            <Input
              maxLength={500}
              value={note}
              placeholder={t("manifest.notePlaceholder")}
              onChange={(event) => setNote(event.target.value)}
            />
            <DialogFooter className="flex-row justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                {tc("actions.cancel")}
              </Button>
              <Button variant="outline" onClick={() => void validate()} disabled={saving}>
                {t("manifest.validate")}
              </Button>
              <Button onClick={() => void save()} disabled={saving}>
                {t("manifest.save")}
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
