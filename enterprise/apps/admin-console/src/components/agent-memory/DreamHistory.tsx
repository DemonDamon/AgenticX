"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, toast } from "@agenticx/ui";
import { useTranslations } from "next-intl";

import { adminFetch } from "../../lib/admin-client-auth";

type DreamStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

type DreamRow = {
  id: string;
  status: DreamStatus;
  session_ids: string[];
  output_memory_store_id: string;
  report?: {
    output_memories?: number;
    rejected?: unknown[];
    sessions_missing?: string[];
  };
  error?: { type?: string; message?: string } | null;
  started_at?: string | null;
  created_at: string;
};

const STATUSES: readonly DreamStatus[] = ["pending", "running", "completed", "failed", "cancelled"];

function asStatus(value: string): DreamStatus {
  if ((STATUSES as readonly string[]).includes(value)) return value as DreamStatus;
  return "failed";
}

export function DreamHistory({
  storeId,
  refreshKey,
  onOpenStore,
}: {
  storeId: string;
  refreshKey: number;
  onOpenStore: (storeId: string) => void;
}) {
  const t = useTranslations("pages.admin.agentMemory.dream");
  const [rows, setRows] = useState<DreamRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await adminFetch(`/api/admin/ma-memory-stores/${storeId}/dreams`, { cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as { data?: { dreams?: DreamRow[] } };
    if (!res.ok) return;
    setRows(json.data?.dreams ?? []);
  }, [storeId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!rows.some((row) => row.status === "pending" || row.status === "running")) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load, rows]);

  function statusLabel(status: DreamStatus): string {
    switch (status) {
      case "pending":
        return t("status.pending");
      case "running":
        return t("status.running");
      case "completed":
        return t("status.completed");
      case "failed":
        return t("status.failed");
      case "cancelled":
        return t("status.cancelled");
      default: {
        const unreachable: never = status;
        return unreachable;
      }
    }
  }

  async function cancel(dreamId: string) {
    const res = await adminFetch(`/api/admin/ma-memory-dreams/${dreamId}/cancel`, { method: "POST" });
    const json = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) {
      toast.error(json.message || t("cancel"));
      return;
    }
    await load();
  }

  return (
    <div className="mt-6 space-y-2">
      <h3 className="text-sm font-medium">{t("history")}</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.status")}</TableHead>
            <TableHead>{t("columns.sessions")}</TableHead>
            <TableHead>{t("columns.output")}</TableHead>
            <TableHead>{t("columns.memories")}</TableHead>
            <TableHead>{t("columns.rejected")}</TableHead>
            <TableHead>{t("columns.started")}</TableHead>
            <TableHead>{t("columns.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const status = asStatus(row.status);
            const missing = row.report?.sessions_missing ?? [];
            return (
              <TableRow key={row.id} onClick={() => setOpenId(openId === row.id ? null : row.id)}>
                <TableCell>
                  {statusLabel(status)}
                  {status === "failed" && openId === row.id ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      <p>{row.error?.type} {row.error?.message}</p>
                      {missing.length > 0 ? <p>{t("missingSessions", { ids: missing.join(", ") })}</p> : null}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>{row.session_ids?.length ?? 0}</TableCell>
                <TableCell>
                  <button type="button" className="underline" onClick={(event) => { event.stopPropagation(); onOpenStore(row.output_memory_store_id); }}>
                    {row.output_memory_store_id}
                  </button>
                </TableCell>
                <TableCell>{row.report?.output_memories ?? 0}</TableCell>
                <TableCell>{row.report?.rejected?.length ?? 0}</TableCell>
                <TableCell>{row.started_at || row.created_at}</TableCell>
                <TableCell>
                  {status === "pending" || status === "running" ? (
                    <Button type="button" size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); void cancel(row.id); }}>
                      {t("cancel")}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
