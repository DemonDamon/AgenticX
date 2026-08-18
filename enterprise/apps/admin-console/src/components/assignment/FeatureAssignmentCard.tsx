"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  toast,
} from "@agenticx/ui";
import { UsersRound } from "lucide-react";
import { useTranslations } from "next-intl";

import { adminFetch } from "../../lib/admin-client-auth";
import {
  fromAssignmentKeys,
  toAssignmentKeys,
  type AssignmentDraft,
} from "../../lib/capability-pack-form";
import { AssignmentScopeEditor } from "./AssignmentScopeEditor";
import { useAssignmentDirectory } from "./useAssignmentDirectory";

const EMPTY: AssignmentDraft = { allMembers: true, deptIds: [], groupIds: [], userIds: [] };

/**
 * 某项功能的开放范围（联网搜索、深度研究）。
 *
 * 与能力包共用同一个选择器和同一套键。**一条分配都没有 = 全员可用**——这类功能是
 * 基础能力，管理员打开总开关就是想让大家用；要求逐个分配才能用，等于每进一个新人
 * 都得记得回来点一次，而漏点的表现是「他那边就是没有」。
 */
export function FeatureAssignmentCard({ feature }: { feature: "web_search" | "deep_research" }) {
  const t = useTranslations("pages.admin.featureAssignment");
  const tc = useTranslations("common");
  const directory = useAssignmentDirectory();
  const [draft, setDraft] = useState<AssignmentDraft>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`/api/admin/feature-assignments/${feature}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as { message?: string; data?: { assignmentKeys?: string[] } };
      if (!res.ok) throw new Error(json.message || tc("states.error"));
      const keys = json.data?.assignmentKeys ?? [];
      // 空列表就是全员，界面上直接显示成全员，别让人对着三个空栏猜。
      setDraft(keys.length === 0 ? EMPTY : fromAssignmentKeys(keys));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("states.error"));
    } finally {
      setLoading(false);
    }
  }, [feature, tc]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await adminFetch(`/api/admin/feature-assignments/${feature}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assignmentKeys: toAssignmentKeys(draft) }),
      });
      const json = (await res.json()) as { message?: string };
      if (!res.ok) throw new Error(json.message || tc("states.error"));
      toast.success(t("saved"));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("states.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UsersRound className="h-5 w-5" />
          {t(`${feature}.title`)}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">{tc("states.loading")}</p>
        ) : (
          <AssignmentScopeEditor
            value={draft}
            onChange={setDraft}
            depts={directory.depts}
            groups={directory.groups}
            users={directory.users}
          />
        )}
        <div className="flex items-center gap-3">
          <Button onClick={() => void save()} disabled={loading || saving}>
            {tc("actions.save")}
          </Button>
          <span className="text-xs text-muted-foreground">{t("ceilingHint")}</span>
        </div>
      </CardContent>
    </Card>
  );
}
