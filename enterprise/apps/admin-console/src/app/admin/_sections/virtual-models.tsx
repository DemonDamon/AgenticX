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
  Input,
  Label,
  toast,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";

import { adminFetch } from "../../../lib/admin-client-auth";

interface TargetDraft {
  model: string;
  weight: string;
  priority: string;
}

interface VirtualModelRow {
  id: string;
  name: string;
  displayName: string;
  enabled: boolean;
  targets: Array<{ model: string; weight: number; priority: number }>;
}

const emptyTarget = (): TargetDraft => ({ model: "", weight: "1", priority: "0" });

export function VirtualModelsPanel() {
  const t = useTranslations("pages.admin.models.virtualModels");
  const tc = useTranslations("common");
  const [rows, setRows] = useState<VirtualModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<VirtualModelRow | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [targets, setTargets] = useState<TargetDraft[]>([emptyTarget()]);
  const [pendingDelete, setPendingDelete] = useState<VirtualModelRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/virtual-models");
      const json = (await res.json()) as { code?: string; data?: { virtualModels?: VirtualModelRow[] } };
      if (!res.ok || json.code !== "00000") {
        toast.error(t("toast.loadFailed"));
        return;
      }
      setRows(json.data?.virtualModels ?? []);
    } catch {
      toast.error(t("toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setDisplayName("");
    setEnabled(true);
    setTargets([emptyTarget()]);
    setOpen(true);
  };

  const openEdit = (row: VirtualModelRow) => {
    setEditing(row);
    setName(row.name);
    setDisplayName(row.displayName);
    setEnabled(row.enabled);
    setTargets(
      row.targets.length > 0
        ? row.targets.map((target) => ({
            model: target.model,
            weight: String(target.weight),
            priority: String(target.priority),
          }))
        : [emptyTarget()],
    );
    setOpen(true);
  };

  const save = async () => {
    const payload = {
      name: name.trim(),
      displayName: displayName.trim(),
      enabled,
      targets: targets.map((target) => ({
        model: target.model.trim(),
        weight: Number(target.weight),
        priority: target.priority.trim() === "" ? 0 : Number(target.priority),
      })),
    };
    const res = await adminFetch(editing ? `/api/admin/virtual-models/${editing.id}` : "/api/admin/virtual-models", {
      method: editing ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { code?: string; message?: string };
    if (!res.ok || json.code !== "00000") {
      toast.error(json.message === "virtual model name already exists" ? t("toast.duplicate") : t("toast.saveFailed"));
      return;
    }
    toast.success(t("toast.saved"));
    setOpen(false);
    await load();
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const res = await adminFetch(`/api/admin/virtual-models/${pendingDelete.id}`, { method: "DELETE" });
    const json = (await res.json()) as { code?: string };
    if (!res.ok || json.code !== "00000") {
      toast.error(t("toast.deleteFailed"));
      return;
    }
    toast.success(t("toast.deleted"));
    setPendingDelete(null);
    await load();
  };

  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t("title")}</h2>
          <p className="text-xs text-muted-foreground">{t("description")}</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          {t("new")}
        </Button>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {row.displayName}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{row.name}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {row.enabled ? t("enabledBadge") : t("disabledBadge")}
                  {" · "}
                  {row.targets.map((target) => `${target.model} (${target.weight}/${target.priority})`).join(", ")}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" onClick={() => openEdit(row)}>
                  {t("edit")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPendingDelete(row)}>
                  {tc("actions.delete")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t("editTitle") : t("createTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("name")}</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("displayName")}</Label>
              <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={enabled} onCheckedChange={(value) => setEnabled(value === true)} />
              {t("enabled")}
            </label>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("targets")}</Label>
                <Button type="button" size="sm" variant="outline" onClick={() => setTargets((prev) => [...prev, emptyTarget()])}>
                  {t("addTarget")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("priorityHint")}</p>
              {targets.map((target, index) => (
                <div key={index} className="grid grid-cols-[1fr_5rem_5rem_auto] gap-2">
                  <Input
                    value={target.model}
                    placeholder={t("model")}
                    onChange={(event) =>
                      setTargets((prev) => prev.map((item, i) => (i === index ? { ...item, model: event.target.value } : item)))
                    }
                  />
                  <Input
                    value={target.weight}
                    placeholder={t("weight")}
                    onChange={(event) =>
                      setTargets((prev) => prev.map((item, i) => (i === index ? { ...item, weight: event.target.value } : item)))
                    }
                  />
                  <Input
                    value={target.priority}
                    placeholder={t("priority")}
                    onChange={(event) =>
                      setTargets((prev) => prev.map((item, i) => (i === index ? { ...item, priority: event.target.value } : item)))
                    }
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={targets.length === 1}
                    onClick={() => setTargets((prev) => prev.filter((_, i) => i !== index))}
                  >
                    {t("removeTarget")}
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={() => void save()}>{tc("actions.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDelete != null} onOpenChange={(next) => (!next ? setPendingDelete(null) : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("deleteBody", { name: pendingDelete?.displayName ?? "" })}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={() => void confirmDelete()}>{tc("actions.delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
