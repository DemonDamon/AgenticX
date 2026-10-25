"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label, Textarea, toast } from "@agenticx/ui";

import { adminFetch } from "../../lib/admin-client-auth";

type Rubric = { id: string; name: string; version: number; content: Record<string, unknown> };

const RULE_TYPES = ["contains", "not_contains", "regex", "tool_called", "tool_not_called", "max_tool_calls", "stop_reason"] as const;

export function RubricsTab() {
  const [rows, setRows] = useState<Rubric[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [criteria, setCriteria] = useState("");
  const [mode, setMode] = useState<"binary" | "score">("binary");
  const [threshold, setThreshold] = useState("0.7");
  const [judgeModel, setJudgeModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [rules, setRules] = useState<Array<{ type: string; value: string }>>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    const res = await adminFetch("/api/admin/ma-evals/rubrics", { cache: "no-store" });
    const json = (await res.json()) as { data?: { rubrics?: Rubric[] } };
    setRows(json.data?.rubrics ?? []);
  }, []);

  useEffect(() => {
    void load();
    void adminFetch("/api/admin/providers", { cache: "no-store" }).then(async (res) => {
      const json = (await res.json()) as { data?: { providers?: Array<{ id: string; models?: Array<{ name: string }> }> } };
      const refs = (json.data?.providers ?? []).flatMap((provider) =>
        (provider.models ?? []).map((model) => `${provider.id}/${model.name}`),
      );
      setModels(refs);
    });
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button type="button" onClick={() => { setErrors([]); setOpen(true); }}>新建评分标准</Button></div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border"><td>{row.name}</td><td>v{row.version}</td></tr>
          ))}
        </tbody>
      </table>
      <Dialog open={open} onOpenChange={(next) => { if (next || errors.length === 0) setOpen(next); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>评分标准</DialogTitle></DialogHeader>
          <Label>名称</Label>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
          <Label>评判说明</Label>
          <Textarea value={criteria} onChange={(event) => setCriteria(event.target.value)} />
          <Label>评判方式</Label>
          <select className="h-9 rounded-md border border-border bg-background px-2" value={mode} onChange={(event) => setMode(event.target.value === "score" ? "score" : "binary")}>
            <option value="binary">是否通过</option>
            <option value="score">打分</option>
          </select>
          {mode === "score" ? (
            <>
              <Label>通过阈值</Label>
              <Input value={threshold} onChange={(event) => setThreshold(event.target.value)} />
            </>
          ) : null}
          <Label>裁判模型</Label>
          <select className="h-9 rounded-md border border-border bg-background px-2" value={judgeModel} onChange={(event) => setJudgeModel(event.target.value)}>
            <option value="">不使用裁判</option>
            {models.map((model) => <option key={model} value={model}>{model}</option>)}
          </select>
          <div className="space-y-2">
            {rules.map((rule, index) => (
              <div key={`${rule.type}-${index}`} className="flex gap-2">
                <select className="h-9 rounded-md border border-border bg-background px-2" value={rule.type} onChange={(event) => setRules(rules.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value } : item))}>
                  {RULE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                <Input value={rule.value} onChange={(event) => setRules(rules.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} />
              </div>
            ))}
            <Button type="button" variant="outline" onClick={() => setRules([...rules, { type: "contains", value: "" }])}>添加规则</Button>
          </div>
          {errors.length > 0 ? <ul className="text-sm text-destructive">{errors.map((item) => <li key={item}>{item}</li>)}</ul> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button
              type="button"
              onClick={() => {
                const content = {
                  criteria,
                  mode,
                  pass_threshold: Number(threshold),
                  judge_model: judgeModel || null,
                  rule_checks: rules.map((rule) => {
                    if (rule.type === "regex") return { type: rule.type, pattern: rule.value };
                    if (rule.type === "tool_called" || rule.type === "tool_not_called") return { type: rule.type, name: rule.value };
                    if (rule.type === "max_tool_calls") return { type: rule.type, value: Number(rule.value) };
                    return { type: rule.type, value: rule.value };
                  }),
                };
                void adminFetch("/api/admin/ma-evals/rubrics", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ name, content }),
                }).then(async (res) => {
                  const json = (await res.json()) as { message?: string; errors?: string[] };
                  if (!res.ok) {
                    setErrors(json.errors ?? [json.message ?? "保存失败"]);
                    toast.error(json.message ?? "保存失败");
                    return;
                  }
                  setOpen(false);
                  setErrors([]);
                  await load();
                });
              }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
