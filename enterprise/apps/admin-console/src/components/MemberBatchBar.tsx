"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@agenticx/ui";
import { Loader2, X } from "lucide-react";

import { adminFetch } from "../lib/admin-client-auth";

type PackRecord = { id: string; displayName: string; status: string; assignmentKeys: string[] };

type Envelope<T> = { code: string; message: string; data?: T };

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const json = (await response.json()) as Envelope<T>;
  if (!response.ok || json.code !== "00000") throw new Error(json.message || fallback);
  return json.data as T;
}

/**
 * 把一组用户 id 并入/移出某个分配集合。
 *
 * 两个分配接口都是整集替换——按它们自己的注释，「让前端 diff 两个集合再发细粒度调用，
 * 正是『只改了一半』的成因」。所以这里也读全量、算好再整集写回，不拼增量。
 */
function nextKeys(current: readonly string[], userIds: readonly string[], grant: boolean): string[] {
  const set = new Set(current);
  for (const id of userIds) {
    if (grant) set.add(id);
    else set.delete(id);
  }
  return [...set];
}

/**
 * 成员列表的批量操作条。
 *
 * 「把一堆人一块改」这件事在这里发生，而不是靠让用户组去持有一份配置——组仍然是授予，
 * 改组会实时影响所有成员；这条操作条改的是被选中的这几个人自己那一份。两者不冲突：
 * 一个是长效规则，一个是临时的一把。
 */
export function MemberBatchBar({
  selectedIds,
  onClear,
  onChanged,
}: {
  selectedIds: readonly string[];
  onClear: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [quotaDraft, setQuotaDraft] = useState("");
  const [packId, setPackId] = useState("");
  const [packs, setPacks] = useState<PackRecord[]>([]);

  // 包列表只在真的选了人之后才拉：没人选时这条操作条根本不显示。
  useEffect(() => {
    if (selectedIds.length === 0 || packs.length > 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await readJson<{ packs: PackRecord[] }>(
          await adminFetch("/api/admin/capability-packs", { cache: "no-store" }),
          "读取能力包失败",
        );
        if (!cancelled) setPacks(data.packs.filter((pack) => pack.status === "active"));
      } catch {
        // 拉不到就只是没有包可选，其余批量操作照常可用。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [packs.length, selectedIds.length]);

  const run = useCallback(
    async (label: string, task: () => Promise<void>) => {
      setBusy(label);
      try {
        await task();
        toast.success(`已对 ${selectedIds.length} 人${label}`);
        onChanged();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `${label}失败`);
      } finally {
        setBusy(null);
      }
    },
    [onChanged, selectedIds.length],
  );

  const toggleFeature = useCallback(
    (feature: "web_search" | "deep_research", grant: boolean, label: string) =>
      run(label, async () => {
        const path = `/api/admin/feature-assignments/${feature}`;
        const current = await readJson<{ assignmentKeys: string[] }>(
          await adminFetch(path, { cache: "no-store" }),
          "读取分配失败",
        );
        await readJson(
          await adminFetch(path, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              assignmentKeys: nextKeys(current.assignmentKeys, selectedIds, grant),
            }),
          }),
          "保存分配失败",
        );
      }),
    [run, selectedIds],
  );

  const bindPack = useCallback(
    () =>
      run("绑定能力包", async () => {
        // 重新拉一次而不是用缓存里的：整集写回时必须基于当下的分配，否则会把别人刚
        // 加进去的那批悄悄抹掉。
        const latest = await readJson<{ packs: PackRecord[] }>(
          await adminFetch("/api/admin/capability-packs", { cache: "no-store" }),
          "读取能力包失败",
        );
        const target = latest.packs.find((pack) => pack.id === packId);
        if (!target) throw new Error("能力包不存在");
        await readJson(
          await adminFetch(`/api/admin/capability-packs/${encodeURIComponent(packId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              assignmentKeys: nextKeys(target.assignmentKeys, selectedIds, true),
            }),
          }),
          "保存能力包失败",
        );
      }),
    [packId, run, selectedIds],
  );

  const applyQuota = useCallback(
    () =>
      run("设置额度", async () => {
        const monthlyTokens = Number(quotaDraft);
        if (!Number.isFinite(monthlyTokens) || monthlyTokens < 0) throw new Error("额度需为非负数字");
        // 额度是一人一条规则，没有批量接口；逐个写，任何一个失败都要说出来是哪个。
        const failures: string[] = [];
        for (const id of selectedIds) {
          try {
            await readJson(
              await adminFetch(`/api/admin/users/${encodeURIComponent(id)}/quota`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ monthlyTokens }),
              }),
              "保存额度失败",
            );
          } catch {
            failures.push(id);
          }
        }
        if (failures.length > 0) throw new Error(`${failures.length} 人未成功，其余已生效`);
      }),
    [quotaDraft, run, selectedIds],
  );

  if (selectedIds.length === 0) return null;

  return (
    <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur">
      <span className="text-sm font-medium">已选 {selectedIds.length} 人</span>
      <span className="h-4 w-px bg-border" />

      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void toggleFeature("web_search", true, "开通联网搜索")}>
        开通联网搜索
      </Button>
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void toggleFeature("web_search", false, "关闭联网搜索")}>
        关闭
      </Button>
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void toggleFeature("deep_research", true, "开通深度研究")}>
        开通深度研究
      </Button>
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void toggleFeature("deep_research", false, "关闭深度研究")}>
        关闭
      </Button>

      <span className="h-4 w-px bg-border" />
      <Select value={packId} onValueChange={setPackId}>
        <SelectTrigger className="h-8 w-44">
          <SelectValue placeholder="选择能力包" />
        </SelectTrigger>
        <SelectContent>
          {packs.map((pack) => (
            <SelectItem key={pack.id} value={pack.id}>
              {pack.displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" disabled={busy !== null || !packId} onClick={() => void bindPack()}>
        绑定
      </Button>

      <span className="h-4 w-px bg-border" />
      <Input
        className="h-8 w-32"
        inputMode="numeric"
        placeholder="月额度 Token"
        value={quotaDraft}
        onChange={(event) => setQuotaDraft(event.target.value)}
      />
      <Button size="sm" variant="outline" disabled={busy !== null || quotaDraft.trim() === ""} onClick={() => void applyQuota()}>
        设置额度
      </Button>

      {busy ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear} disabled={busy !== null}>
        <X className="h-4 w-4" />取消选择
      </Button>
    </div>
  );
}
