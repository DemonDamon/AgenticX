"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  toast,
} from "@agenticx/ui";
import { ArrowUpRight, Pencil, RefreshCw, UsersRound } from "lucide-react";
import { adminFetch } from "../../../lib/admin-client-auth";
import { QuotaRing, formatTokenCount } from "../../../components/QuotaRing";

type ModelUsage = { model: string; tokens: number };
type UserQuotaOverview = {
  id: string;
  displayName: string;
  email: string;
  deptId: string | null;
  usedTokens: number;
  monthlyTokens: number;
  unlimited: boolean;
  inherited: boolean;
  groupNames: string[];
  topModels: ModelUsage[];
};
type ApiEnvelope<T> = { code: string; message: string; data?: T };

export default function RolesPage() {
  const [items, setItems] = useState<UserQuotaOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<UserQuotaOverview | null>(null);
  const [monthlyTokens, setMonthlyTokens] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminFetch("/api/admin/users/quota-overview", { cache: "no-store" });
      const json = (await response.json()) as ApiEnvelope<{ items: UserQuotaOverview[] }>;
      if (!response.ok || json.code !== "00000") throw new Error(json.message || "加载用户额度失败");
      setItems(json.data?.items ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载用户额度失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openEditor = (user: UserQuotaOverview) => {
    setSelected(user);
    setMonthlyTokens(String(user.monthlyTokens));
  };

  const save = async (inherit = false) => {
    if (!selected || saving) return;
    const next = Number(monthlyTokens || 0);
    if (!inherit && (!Number.isFinite(next) || next < 0)) {
      toast.error("请输入大于或等于 0 的 Token 数");
      return;
    }
    setSaving(true);
    try {
      const response = await adminFetch(`/api/admin/users/${selected.id}/quota`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(inherit ? { inherit: true } : { monthlyTokens: Math.floor(next) }),
      });
      const json = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok || json.code !== "00000") throw new Error(json.message || "保存失败");
      toast.success(inherit ? "已恢复默认额度" : "个人额度已保存");
      setSelected(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">按成员独立计量</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">用户额度</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            每位成员都有独立的月度 Token 额度和消耗记录。用户组可用于批量下发相同设置，但不会把成员放进共享额度池。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild><Link href="/iam/groups">管理用户组<ArrowUpRight /></Link></Button>
          <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} />刷新用量</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {loading && items.length === 0 ? [1, 2, 3, 4, 5, 6].map((key) => <Card key={key} className="min-h-64"><CardHeader><Skeleton className="h-6 w-36" /><Skeleton className="h-4 w-48" /></CardHeader><CardContent className="flex gap-5"><Skeleton className="h-28 w-28 rounded-full" /><Skeleton className="h-24 flex-1" /></CardContent></Card>) : null}
        {!loading && items.length === 0 ? <Card className="border-dashed md:col-span-2 2xl:col-span-3"><CardContent className="flex min-h-64 flex-col items-center justify-center text-center"><span className="rounded-full bg-primary/10 p-3 text-primary"><UsersRound className="h-6 w-6" /></span><h2 className="mt-4 font-semibold">暂无成员</h2><p className="mt-1 text-sm text-muted-foreground">开通成员后会在这里显示每个人的额度和使用情况。</p></CardContent></Card> : null}
        {items.map((user) => (
          <Card key={user.id} className="group cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/20" onClick={() => openEditor(user)}>
            <CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><CardTitle className="truncate">{user.displayName}</CardTitle><CardDescription className="mt-1 truncate">{user.email}</CardDescription></div><Badge variant={user.inherited ? "secondary" : "outline"} className="shrink-0">{user.inherited ? "默认设置" : "个人设置"}</Badge></div></CardHeader>
            <CardContent className="space-y-4"><div className="flex items-center gap-4"><QuotaRing used={user.usedTokens} limit={user.monthlyTokens} unlimited={user.unlimited} size={112} /><div className="min-w-0 space-y-2 text-sm"><p className="text-muted-foreground">本月个人额度</p><p className="font-semibold">{user.unlimited ? "不限制" : `${formatTokenCount(user.monthlyTokens)} Token`}</p><p className="text-xs text-muted-foreground">已用 {formatTokenCount(user.usedTokens)} Token</p><span className="inline-flex items-center gap-1 text-xs text-primary"><Pencil className="h-3 w-3" />调整个人额度</span></div></div><div className="space-y-2 border-t border-border pt-3"><div className="flex flex-wrap gap-1.5">{user.groupNames.length ? user.groupNames.map((name) => <Badge key={name} variant="outline" className="font-normal">{name}</Badge>) : <span className="text-xs text-muted-foreground">未加入用户组</span>}</div><div className="flex flex-wrap gap-1.5">{user.topModels.length ? user.topModels.map((model) => <Badge key={model.model} variant="secondary" className="max-w-full truncate font-normal">{model.model} · {formatTokenCount(model.tokens)}</Badge>) : <span className="text-xs text-muted-foreground">本月尚无模型消耗</span>}</div></div></CardContent>
          </Card>
        ))}
      </div>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-lg">
          {selected ? <><SheetHeader className="border-b border-border pb-5"><SheetTitle>编辑用户额度</SheetTitle><SheetDescription>{selected.displayName} 的额度独立于其他成员；用户组再次保存时可重新下发其设置。</SheetDescription></SheetHeader><div className="space-y-5 py-6"><div className="rounded-xl border border-border bg-muted/20 p-4"><p className="font-medium">{selected.displayName}</p><p className="mt-1 text-sm text-muted-foreground">本月已用 {formatTokenCount(selected.usedTokens)} Token</p></div><div className="space-y-2"><Label htmlFor="user-monthly-tokens">每月 Token 额度</Label><Input id="user-monthly-tokens" inputMode="numeric" value={monthlyTokens} onChange={(event) => setMonthlyTokens(event.target.value.replace(/[^0-9]/g, ""))} placeholder="0 表示不限制" /><p className="text-xs text-muted-foreground">设置为 0 时，该成员不受月度 Token 上限限制。</p></div></div><div className="mt-auto flex flex-wrap justify-between gap-2 border-t border-border pt-4"><Button variant="outline" onClick={() => void save(true)} disabled={saving || selected.inherited}>恢复默认</Button><div className="flex gap-2"><Button variant="outline" onClick={() => setSelected(null)}>取消</Button><Button onClick={() => void save()} disabled={saving}>{saving ? "保存中…" : "保存额度"}</Button></div></div></> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
