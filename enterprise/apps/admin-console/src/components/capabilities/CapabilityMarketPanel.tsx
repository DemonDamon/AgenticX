"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from "@agenticx/ui";
import { Boxes, Globe, Puzzle, Search, Server, X } from "lucide-react";

import { useCapabilityCatalog, type PackRecord } from "./use-capability-catalog";

type KindFilter = "all" | "mcp" | "skill" | "feature";

/**
 * 扫描结论的呈现。
 *
 * 「未扫描」不能和「安全」长得一样——管理员会把「没查过」看成「查过没问题」，而这一页
 * 上点一下就发给全公司了。所以未扫描单独一档，用中性但显眼的样式。
 */
function scanBadge(verdict: string | null | undefined, findingCount: number) {
  switch (verdict) {
    case "safe":
      return { label: "扫描通过", variant: "outline" as const, tone: "text-emerald-600" };
    case "caution":
      return {
        label: findingCount > 0 ? `需警惕 · ${findingCount} 条` : "需警惕",
        variant: "outline" as const,
        tone: "text-amber-600",
      };
    case "dangerous":
      return {
        label: findingCount > 0 ? `高危 · ${findingCount} 条` : "高危",
        variant: "destructive" as const,
        tone: "",
      };
    default:
      return { label: "未扫描", variant: "secondary" as const, tone: "" };
  }
}

const KIND_TABS: { id: KindFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "mcp", label: "MCP 服务" },
  { id: "skill", label: "Skill" },
  { id: "feature", label: "平台功能" },
];

/** 一项能力已经躺在哪些包里。卡片上要显示这个，否则管理员会重复往包里加。 */
function packsHolding(packs: readonly PackRecord[], capabilityId: string): PackRecord[] {
  return packs.filter((pack) => pack.capabilityIds.includes(capabilityId));
}

/**
 * 能力货架。
 *
 * 管理员挑东西时想的是「有哪些能力可以发下去」，不是「这条 MCP 记录的 bundleUri 填了
 * 什么」。注册表那三个面板是维护记录用的，这一页是按货架翻——搜索、按类型筛、卡片上
 * 直接看到它已经在哪些包里，勾一批直接加进某个包。
 *
 * 货架上的东西全部来自本企业自己的注册表。这是有意的：员工能装什么由管理员决定，
 * 就不该有一条运行时通道去公网目录取货。从 SkillHub 引进新技能是管理员的一次性动作，
 * 走注册表那一侧，不在这里。
 */
export function CapabilityMarketPanel() {
  const { packs, skills, choices, loading, send } = useCapabilityCatalog(
    "加载能力失败",
    "操作失败",
  );
  const [kind, setKind] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [targetPackId, setTargetPackId] = useState("");
  const [saving, setSaving] = useState(false);

  const skillById = useMemo(
    () => new Map(skills.map((skill) => [`skill:${skill.id.toUpperCase()}`, skill])),
    [skills],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return choices.filter((choice) => {
      if (kind !== "all" && choice.kind !== kind) return false;
      if (!q) return true;
      const skill = skillById.get(choice.id);
      return [choice.displayName, choice.name, skill?.description]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(q);
    });
  }, [choices, kind, query, skillById]);

  const toggle = useCallback((id: string) => {
    setPicked((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }, []);

  const addToPack = useCallback(async () => {
    const pack = packs.find((item) => item.id === targetPackId);
    if (!pack) return;
    setSaving(true);
    try {
      // 整集写回，且基于当下这份 pack.capabilityIds 求并集——只发新增的话，
      // 接口那边是整体替换语义，会把包里原有的成员抹掉。
      const merged = [...new Set([...pack.capabilityIds, ...picked])];
      const added = merged.length - pack.capabilityIds.length;
      if (added === 0) {
        toast.info("选中的能力都已经在这个包里了");
        return;
      }
      const ok = await send(`/api/admin/capability-packs/${encodeURIComponent(pack.id)}`, "PATCH", {
        capabilityIds: merged,
      });
      if (ok) {
        toast.success(`已向「${pack.displayName || pack.slug}」加入 ${added} 项能力`);
        setPicked([]);
      }
    } finally {
      setSaving(false);
    }
  }, [packs, picked, send, targetPackId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border p-0.5">
          {KIND_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`rounded-md px-3 py-1.5 text-sm transition ${
                kind === tab.id ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60"
              }`}
              onClick={() => setKind(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索能力名称或说明"
            aria-label="搜索能力"
            className="pl-9"
          />
        </div>
      </div>

      {loading && choices.length === 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((key) => (
            <Card key={key}>
              <CardContent className="space-y-2 p-4">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-4 w-48" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {choices.length === 0
              ? "货架是空的。先在「MCP 托管」或「Skill 注册表」里登记，这里才有东西可发。"
              : "没有匹配的能力。"}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((choice) => {
            const skill = skillById.get(choice.id);
            const holders = packsHolding(packs, choice.id);
            const selected = picked.includes(choice.id);
            return (
              <Card
                key={choice.id}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                className={`cursor-pointer transition-colors ${
                  selected ? "border-primary bg-primary/5" : "hover:border-primary/50"
                }`}
                onClick={() => toggle(choice.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggle(choice.id);
                  }
                }}
              >
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {choice.kind === "mcp" ? (
                        <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : choice.kind === "feature" ? (
                        <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <Puzzle className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate font-medium">{choice.displayName}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {choice.kind === "skill"
                        ? (() => {
                            const scan = scanBadge(
                              skill?.scanVerdict,
                              skill?.scanFindings?.length ?? 0,
                            );
                            return (
                              <Badge
                                variant={scan.variant}
                                className={`font-normal ${scan.tone}`}
                                title={
                                  skill?.scannedAt
                                    ? `扫描于 ${new Date(skill.scannedAt).toLocaleString()}`
                                    : "从未扫描，多为手工登记"
                                }
                              >
                                {scan.label}
                              </Badge>
                            );
                          })()
                        : null}
                      {choice.disabled ? <Badge variant="secondary">已停用</Badge> : null}
                    </div>
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {skill?.description || choice.name}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {holders.length > 0 ? (
                      holders.map((pack) => (
                        <Badge key={pack.id} variant="outline" className="font-normal">
                          {pack.displayName || pack.slug}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">尚未加入任何能力包</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {picked.length > 0 ? (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur">
          <Boxes className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">已选 {picked.length} 项</span>
          <Select value={targetPackId} onValueChange={setTargetPackId}>
            <SelectTrigger className="h-8 w-52">
              <SelectValue placeholder="加入哪个能力包" />
            </SelectTrigger>
            <SelectContent>
              {packs.map((pack) => (
                <SelectItem key={pack.id} value={pack.id}>
                  {pack.displayName || pack.slug}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={!targetPackId || saving} onClick={() => void addToPack()}>
            加入
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setPicked([])}>
            <X className="h-4 w-4" />
            取消选择
          </Button>
        </div>
      ) : null}
    </div>
  );
}
