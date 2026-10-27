"use client";

import React, { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
  toast,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";

import { adminFetch } from "../../lib/admin-client-auth";

function stamp(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}${month}${day}`;
}

function sessionIds(raw: string): string[] {
  const seen: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const id = line.trim();
    if (id && !seen.includes(id)) seen.push(id);
  }
  return seen;
}

export function DreamDialog({
  open,
  storeId,
  storeName,
  onOpenChange,
}: {
  open: boolean;
  storeId: string;
  storeName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.admin.agentMemory.dream");
  const tc = useTranslations("pages.admin.agentMemory.actions");
  const [sessions, setSessions] = useState("");
  const [instructions, setInstructions] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [outputName, setOutputName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSessions("");
    setInstructions(t("defaultInstructions"));
    setOutputName(`${storeName}-整理-${stamp()}`);
    setDescription("");
    void adminFetch("/api/admin/providers", { cache: "no-store" }).then(async (res) => {
      const json = (await res.json().catch(() => ({}))) as {
        data?: { providers?: Array<{ id: string; models?: Array<{ name: string }> }> };
      };
      const refs = (json.data?.providers ?? []).flatMap((provider) =>
        (provider.models ?? []).map((item) => `${provider.id}/${item.name}`),
      );
      setModels(refs);
      setModel(refs[0] ?? "");
    });
  }, [open, storeName, t]);

  async function submit() {
    const ids = sessionIds(sessions);
    if (ids.length < 1 || ids.length > 100) {
      toast.error(t("sessionsPlaceholder"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await adminFetch(`/api/admin/ma-memory-stores/${storeId}/dreams`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_ids: ids,
          instructions,
          model,
          output_memory_store_name: outputName,
          ...(description ? { output_memory_store_description: description } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        toast.error(json.message || t("submit"));
        return;
      }
      toast.success(t("toast.started"));
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("start")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Label>{t("sessions")}</Label>
          <Textarea value={sessions} placeholder={t("sessionsPlaceholder")} onChange={(event) => setSessions(event.target.value)} />
          <p className="text-xs text-muted-foreground">{t("sessionHint")}</p>
          <Label>{t("instructions")}</Label>
          <Textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} />
          <Label>{t("model")}</Label>
          <select className="h-9 w-full rounded-md border border-border bg-background px-2" value={model} onChange={(event) => setModel(event.target.value)}>
            {models.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <Label>{t("outputName")}</Label>
          <Input value={outputName} onChange={(event) => setOutputName(event.target.value)} />
          <Label>{t("outputDescription")}</Label>
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
          <Button type="button" disabled={submitting} onClick={() => void submit()}>{t("submit")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
