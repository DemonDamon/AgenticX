"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Input, Label, Switch, toast } from "@agenticx/ui";
import { Loader2 } from "lucide-react";

import { adminFetch } from "../../lib/admin-client-auth";

export type QuotaScope = "departments" | "apiTokens";

type QuotaRule = {
  monthlyTokens: number;
  dailyTokens?: number;
  weeklyTokens?: number;
  poolScope?: "" | "dept" | "tenant";
  action?: string;
};

type QuotaConfig = Record<string, unknown> & {
  departments?: Record<string, QuotaRule>;
  apiTokens?: Record<string, QuotaRule>;
};

type Envelope<T> = { code: string; message: string; data?: T };

const EMPTY: QuotaRule = { monthlyTokens: 0, action: "block" };

/**
 * 某个具体对象的额度规则。
 *
 * 原来这些规则在一个「把 ID 贴进输入框」的表里改——想给某个部门配额度，得先去别处找到
 * 那串 ULID 再粘回来。编辑器放回对象自己的上下文里（部门树上的部门、凭据页上的令牌），
 * ID 就不必出现在界面上，也不用人去记。
 *
 * 写回时只改自己这一条，其余原样带回：这份配置里还躺着别的作用域的规则，整份覆盖会把
 * 别人刚配的抹掉。
 */
export function QuotaScopeEditor({
  scope,
  id,
  onSaved,
}: {
  scope: QuotaScope;
  id: string;
  onSaved?: () => void;
}) {
  const [config, setConfig] = useState<QuotaConfig | null>(null);
  const [rule, setRule] = useState<QuotaRule>(EMPTY);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/metering/quota", { cache: "no-store" });
      const json = (await res.json()) as Envelope<{ quota?: QuotaConfig }>;
      if (!res.ok || json.code !== "00000") throw new Error(json.message || "读取额度失败");
      const quota = json.data?.quota ?? {};
      setConfig(quota);
      const existing = (quota[scope] ?? {})[id];
      setEnabled(Boolean(existing));
      setRule(existing ?? EMPTY);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取额度失败");
    } finally {
      setLoading(false);
    }
  }, [id, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    try {
      const map = { ...(config[scope] ?? {}) };
      // 关掉开关 = 删掉这条规则，回落到上一级；不是把上限设成 0，那是「一个都不给」。
      if (enabled) map[id] = rule;
      else delete map[id];
      const res = await adminFetch("/api/metering/quota", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, [scope]: map }),
      });
      const json = (await res.json()) as Envelope<unknown>;
      if (!res.ok || json.code !== "00000") throw new Error(json.message || "保存失败");
      toast.success(enabled ? "额度已保存" : "已改为继承上一级");
      await load();
      onSaved?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存额度失败");
    } finally {
      setSaving(false);
    }
  }, [config, enabled, id, load, onSaved, rule, scope]);

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        读取中…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">单独设置额度</p>
          <p className="mt-1 text-xs text-muted-foreground">
            关闭则继承上一级（部门继承租户默认，令牌继承持有人）。
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="单独设置额度" />
      </div>

      {enabled ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ["monthlyTokens", "每月 Token"],
              ["weeklyTokens", "每周 Token"],
              ["dailyTokens", "每日 Token"],
            ] as const
          ).map(([field, label]) => (
            <div key={field} className="space-y-1.5">
              <Label className="text-xs">{label}</Label>
              <Input
                inputMode="numeric"
                value={String(rule[field] ?? 0)}
                onChange={(event) => {
                  const next = Number(event.target.value.replace(/[^\d]/g, "")) || 0;
                  setRule((current) => ({ ...current, [field]: next }));
                }}
              />
              <p className="text-[11px] text-muted-foreground">0 表示不限制</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </div>
  );
}
