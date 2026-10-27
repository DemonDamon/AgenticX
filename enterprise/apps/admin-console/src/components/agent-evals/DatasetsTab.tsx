"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";

import { adminFetch } from "../../lib/admin-client-auth";

type Dataset = { id: string; name: string; description: string | null; itemCount: number; updatedAt: string };
type Item = {
  id: string;
  position: number;
  query: string;
  expectedAnswer: string | null;
  sourceSessionId: string | null;
};

async function readJson(res: Response): Promise<{ message?: string; errors?: string[]; data?: Record<string, unknown> }> {
  return (await res.json()) as { message?: string; errors?: string[]; data?: Record<string, unknown> };
}

export function DatasetsTab() {
  const t = useTranslations("pages.admin.agentEvals");
  const tc = useTranslations("common");
  const [rows, setRows] = useState<Dataset[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [active, setActive] = useState<Dataset | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [useAnswer, setUseAnswer] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await adminFetch("/api/admin/ma-evals/datasets", { cache: "no-store" });
    const json = await readJson(res);
    const datasets = json.data?.datasets;
    setRows(Array.isArray(datasets) ? (datasets as Dataset[]) : []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDataset(row: Dataset) {
    setActive(row);
    const res = await adminFetch(`/api/admin/ma-evals/datasets/${row.id}/items`, { cache: "no-store" });
    const json = await readJson(res);
    const list = json.data?.items;
    setItems(Array.isArray(list) ? (list as Item[]) : []);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" onClick={() => setOpen(true)}>{t("actions.createDataset")}</Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th>{t("columns.name")}</th>
            <th>{t("columns.itemCount")}</th>
            <th>{t("columns.updatedAt")}</th>
            <th>{t("columns.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border">
              <td>{row.name}</td>
              <td>{row.itemCount}</td>
              <td>{row.updatedAt}</td>
              <td className="space-x-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void openDataset(row)}>{t("actions.view")}</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setDeleteId(row.id)}>{tc("actions.delete")}</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("datasets.createTitle")}</DialogTitle></DialogHeader>
          <Label>{t("fields.name")}</Label>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>{tc("actions.cancel")}</Button>
            <Button
              type="button"
              onClick={() => {
                void adminFetch("/api/admin/ma-evals/datasets", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ name }),
                }).then(async (res) => {
                  if (!res.ok) {
                    toast.error((await readJson(res)).message ?? t("datasets.saveFailed"));
                    return;
                  }
                  setOpen(false);
                  setName("");
                  await load();
                });
              }}
            >
              {tc("actions.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Sheet open={active != null} onOpenChange={(next) => { if (!next) setActive(null); }}>
        <SheetContent className="w-[min(860px,96vw)] overflow-y-auto sm:max-w-none">
          <SheetHeader><SheetTitle>{active?.name}</SheetTitle></SheetHeader>
          <Button type="button" className="my-3" onClick={() => { setErrors([]); setAddOpen(true); }}>{t("actions.addItems")}</Button>
          <table className="w-full text-sm">
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-border">
                  <td>{item.query.slice(0, 80)}</td>
                  <td>{item.expectedAnswer ? t("datasets.hasExpected") : t("datasets.noExpected")}</td>
                  <td>{item.sourceSessionId ? <a href={`/ops/logs/managed/${item.sourceSessionId}`}>{t("datasets.sourceSession")}</a> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SheetContent>
      </Sheet>
      <Dialog open={addOpen} onOpenChange={(next) => { if (next || errors.length === 0) setAddOpen(next); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("datasets.addItemsTitle")}</DialogTitle></DialogHeader>
          <Tabs defaultValue="paste">
            <TabsList>
              <TabsTrigger value="paste">{t("datasets.pasteJson")}</TabsTrigger>
              <TabsTrigger value="file">{t("datasets.uploadFile")}</TabsTrigger>
              <TabsTrigger value="session">{t("datasets.importSession")}</TabsTrigger>
            </TabsList>
            <TabsContent value="paste">
              <Textarea value={text} onChange={(event) => setText(event.target.value)} rows={8} />
            </TabsContent>
            <TabsContent value="file">
              <Input
                type="file"
                accept=".json,.jsonl,.csv"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void file.text().then(setText);
                }}
              />
            </TabsContent>
            <TabsContent value="session" className="space-y-2">
              <Label>{t("fields.sessionId")}</Label>
              <Input value={sessionId} onChange={(event) => setSessionId(event.target.value)} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={useAnswer} onChange={(event) => setUseAnswer(event.target.checked)} />
                {t("fields.useAnswerAsExpected")}
              </label>
            </TabsContent>
          </Tabs>
          {errors.length > 0 ? <ul className="text-sm text-destructive">{errors.map((item) => <li key={item}>{item}</li>)}</ul> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>{tc("actions.cancel")}</Button>
            <Button
              type="button"
              onClick={() => {
                if (!active) return;
                const path = sessionId
                  ? `/api/admin/ma-evals/datasets/${active.id}/items/import-session`
                  : `/api/admin/ma-evals/datasets/${active.id}/items`;
                const payload = sessionId
                  ? { session_id: sessionId, use_answer_as_expected: useAnswer }
                  : { format: text.trim().startsWith("[") ? "json" : text.includes("\n{") ? "jsonl" : "csv", text };
                void adminFetch(path, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(payload),
                }).then(async (res) => {
                  const json = await readJson(res);
                  if (!res.ok) {
                    setErrors(json.errors ?? [json.message ?? t("datasets.parseFailed")]);
                    return;
                  }
                  setAddOpen(false);
                  setErrors([]);
                  await openDataset(active);
                  await load();
                });
              }}
            >
              {tc("actions.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteId != null} onOpenChange={(next) => { if (!next) setDeleteId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("datasets.deleteTitle")}</DialogTitle></DialogHeader>
          <p>{t("datasets.deleteConfirm")}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteId(null)}>{tc("actions.cancel")}</Button>
            <Button
              type="button"
              onClick={() => {
                if (!deleteId) return;
                void adminFetch(`/api/admin/ma-evals/datasets/${deleteId}`, { method: "DELETE" }).then(async () => {
                  setDeleteId(null);
                  await load();
                });
              }}
            >
              {tc("actions.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
