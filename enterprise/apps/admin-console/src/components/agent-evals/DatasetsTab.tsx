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
        <Button type="button" onClick={() => setOpen(true)}>新建评测集</Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th>名称</th><th>用例数</th><th>更新时间</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border">
              <td>{row.name}</td>
              <td>{row.itemCount}</td>
              <td>{row.updatedAt}</td>
              <td className="space-x-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void openDataset(row)}>查看</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setDeleteId(row.id)}>删除</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>新建评测集</DialogTitle></DialogHeader>
          <Label>名称</Label>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button
              type="button"
              onClick={() => {
                void adminFetch("/api/admin/ma-evals/datasets", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ name }),
                }).then(async (res) => {
                  if (!res.ok) {
                    toast.error((await readJson(res)).message ?? "保存失败");
                    return;
                  }
                  setOpen(false);
                  setName("");
                  await load();
                });
              }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Sheet open={active != null} onOpenChange={(next) => { if (!next) setActive(null); }}>
        <SheetContent className="w-[min(860px,96vw)] overflow-y-auto sm:max-w-none">
          <SheetHeader><SheetTitle>{active?.name}</SheetTitle></SheetHeader>
          <Button type="button" className="my-3" onClick={() => { setErrors([]); setAddOpen(true); }}>添加用例</Button>
          <table className="w-full text-sm">
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-border">
                  <td>{item.query.slice(0, 80)}</td>
                  <td>{item.expectedAnswer ? "有期望回答" : "无期望回答"}</td>
                  <td>{item.sourceSessionId ? <a href={`/ops/logs/managed/${item.sourceSessionId}`}>来源会话</a> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SheetContent>
      </Sheet>
      <Dialog open={addOpen} onOpenChange={(next) => { if (next || errors.length === 0) setAddOpen(next); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>添加用例</DialogTitle></DialogHeader>
          <Tabs defaultValue="paste">
            <TabsList>
              <TabsTrigger value="paste">粘贴 JSON</TabsTrigger>
              <TabsTrigger value="file">上传文件</TabsTrigger>
              <TabsTrigger value="session">从会话导入</TabsTrigger>
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
              <Label>会话 ID</Label>
              <Input value={sessionId} onChange={(event) => setSessionId(event.target.value)} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={useAnswer} onChange={(event) => setUseAnswer(event.target.checked)} />
                把该会话的最终回答作为期望回答
              </label>
            </TabsContent>
          </Tabs>
          {errors.length > 0 ? <ul className="text-sm text-destructive">{errors.map((item) => <li key={item}>{item}</li>)}</ul> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
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
                    setErrors(json.errors ?? [json.message ?? "解析失败"]);
                    return;
                  }
                  setAddOpen(false);
                  setErrors([]);
                  await openDataset(active);
                  await load();
                });
              }}
            >
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteId != null} onOpenChange={(next) => { if (!next) setDeleteId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>删除评测集</DialogTitle></DialogHeader>
          <p>确认删除这个评测集？已有评测任务不会受影响。</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteId(null)}>取消</Button>
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
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
