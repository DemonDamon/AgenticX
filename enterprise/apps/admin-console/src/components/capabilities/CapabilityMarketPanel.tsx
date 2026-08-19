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
import { Boxes, Globe, Puzzle, Search, Server, Store, X } from "lucide-react";

import { plainText } from "../../lib/plain-text";
import { useCapabilityCatalog, type PackRecord } from "./use-capability-catalog";
import { MarketImportDialog, type MarketSource } from "./MarketImportDialog";

type KindFilter = "all" | "mcp" | "skill" | "feature";

/**
 * 扫描结论的呈现。
 *
 * 只有真的存在结论时才显示。我们自己不扫——218 条正则拦不住想绕的人，而一个绿色的
 * 「扫描通过」会把「规则没匹配上」翻译成一句安全承诺，那个承诺兑现不了。装什么最终
 * 是管理员的决定，我们是软件提供商，不替他判断。
 *
 * 字段和写入接口留着：管理员如果用自己信任的工具扫过，可以把结论记进来，货架上就显示
 * 出来。没记就什么都不显示，而不是给每个技能挂一个「未扫描」。
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
      return null;
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
  const { packs, skills, choices, loading, send, load: catalogReload } = useCapabilityCatalog(
    "加载能力失败",
    "操作失败",
  );
  const [kind, setKind] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [targetPackId, setTargetPackId] = useState("");
  const [saving, setSaving] = useState(false);
  const [marketSource, setMarketSource] = useState<MarketSource | null>(null);

  const skillById = useMemo(
    () => new Map(skills.map((skill) => [`skill:${skill.id.toUpperCase()}`, skill])),
    [skills],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return choices.filter((choice) => {
      if (kind !== "all" && choice.kind !== kind) return false;
      if (!q) return true;
      return [choice.displayName, choice.name, plainText(choice.description)]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(q);
    });
  }, [choices, kind, query]);

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
        <Button variant="outline" size="sm" onClick={() => setMarketSource("skill")}>
          <Store className="h-4 w-4" />
          从 SkillHub 添加
        </Button>
        <Button variant="outline" size="sm" onClick={() => setMarketSource("mcp")}>
          <Store className="h-4 w-4" />
          浏览 MCP 市场
        </Button>
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
              ? "货架是空的。点上面的「从 SkillHub 添加」挑技能，或在「MCP 托管」里登记服务。"
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
                      {(() => {
                        if (choice.kind !== "skill") return null;
                        const scan = scanBadge(
                          skill?.scanVerdict,
                          skill?.scanFindings?.length ?? 0,
                        );
                        if (!scan) return null;
                        return (
                          <Badge
                            variant={scan.variant}
                            className={`font-normal ${scan.tone}`}
                            title={
                              skill?.scannedAt
                                ? `扫描于 ${new Date(skill.scannedAt).toLocaleString()}`
                                : undefined
                            }
                          >
                            {scan.label}
                          </Badge>
                        );
                      })()}
                      {choice.disabled ? <Badge variant="secondary">已停用</Badge> : null}
                    </div>
                  </div>
                  <p className="truncate font-mono text-xs text-muted-foreground">{choice.name}</p>
                  <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
                    {plainText(choice.description) || "（无说明）"}
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
      <MarketImportDialog
        source={marketSource ?? "skill"}
        open={marketSource !== null}
        onOpenChange={(open) => setMarketSource(open ? marketSource : null)}
        onImported={() => {
          setMarketSource(null);
          void catalogReload();
        }}
      />

    </div>
  );
}
