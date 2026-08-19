"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  toast,
} from "@agenticx/ui";
import { ExternalLink, Loader2, Search } from "lucide-react";

import { adminFetch } from "../../lib/admin-client-auth";

type MarketSkill = {
  name: string;
  displayName: string;
  description: string;
  version: string;
  author: string;
  namespace: string;
  canonicalName: string;
  detailUrl: string;
};

type MarketMcp = {
  id: string;
  name: string;
  description: string;
  publisher: string;
  hosted: boolean;
  verified: boolean;
  detailUrl: string;
};

type McpDetail = {
  id: string;
  name: string;
  description: string;
  suggestedName: string;
  command: string;
  args: string[];
  endpoint: string;
  requiredEnv: string[];
  detailUrl: string;
};

type Envelope<T> = { code: string; message: string; data?: T };

export type MarketSource = "skill" | "mcp";

/**
 * 从外部市场挑一个登记进本企业注册表。
 *
 * 在这之前，管理员要新增一个技能得手抄 slug、bundleUri、digest 三个字段——抄错一个字符
 * 就是员工那边装不上，而且看不出错在哪。
 *
 * 这里只把市场的元数据填进表单，不下载、不执行、不判断安不安全。装什么是管理员的决定，
 * 我们只负责别让他手抄。
 */
export function MarketImportDialog({
  source,
  open,
  onOpenChange,
  onImported,
}: {
  source: MarketSource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<(MarketSkill | MarketMcp)[]>([]);
  const [loading, setLoading] = useState(false);
  const [unreachable, setUnreachable] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [detail, setDetail] = useState<McpDetail | null>(null);
  const [mcpName, setMcpName] = useState("");
  const [mcpEnv, setMcpEnv] = useState<Record<string, string>>({});

  const search = useCallback(async () => {
    setLoading(true);
    setUnreachable(null);
    try {
      const res = await adminFetch(
        `/api/admin/registry/search?source=${source}&q=${encodeURIComponent(query)}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as Envelope<{ items?: (MarketSkill | MarketMcp)[] }>;
      if (res.status === 503) {
        // 连不上市场和搜不到东西是两回事，说清楚，否则管理员会一直换关键词。
        setUnreachable(json.message);
        setItems([]);
        return;
      }
      if (!res.ok || json.code !== "00000") throw new Error(json.message || "搜索失败");
      setItems(json.data?.items ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "搜索失败");
    } finally {
      setLoading(false);
    }
  }, [query, source]);

  useEffect(() => {
    if (open) void search();
    // 打开时搜一次空关键词拿热门；关键词变化由按钮和回车触发，不做输入即搜。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source]);

  const importSkill = useCallback(
    async (item: MarketSkill) => {
      setImporting(item.canonicalName);
      try {
        const res = await adminFetch("/api/admin/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug: item.canonicalName || item.name,
            displayName: item.displayName || item.name,
            description: item.description,
            version: item.version,
            bundleUri: item.detailUrl,
          }),
        });
        const json = (await res.json()) as Envelope<unknown>;
        if (!res.ok || json.code !== "00000") throw new Error(json.message || "登记失败");
        toast.success(`已登记「${item.displayName || item.name}」`);
        onImported();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "登记失败");
      } finally {
        setImporting(null);
      }
    },
    [onImported],
  );

  const openMcpDetail = useCallback(async (id: string) => {
    setImporting(id);
    try {
      const res = await adminFetch(
        `/api/admin/registry/search?source=mcp&id=${encodeURIComponent(id)}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as Envelope<{ detail?: McpDetail }>;
      if (!res.ok || json.code !== "00000" || !json.data?.detail) {
        throw new Error(json.message || "读取详情失败");
      }
      const d = json.data.detail;
      setDetail(d);
      setMcpName(d.suggestedName);
      setMcpEnv(Object.fromEntries(d.requiredEnv.map((key) => [key, ""])));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取详情失败");
    } finally {
      setImporting(null);
    }
  }, []);

  const registerMcp = useCallback(async () => {
    if (!detail) return;
    setImporting(detail.id);
    try {
      // 托管地址优先：有它就不用在企业机器上装运行时。没有就登记 stdio 启动命令。
      const backendConfig = detail.endpoint
        ? { endpoint: detail.endpoint, env: mcpEnv }
        : { command: detail.command, args: detail.args, env: mcpEnv };
      const res = await adminFetch("/api/admin/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: mcpName.trim(),
          displayName: detail.name,
          transport: detail.endpoint ? "streamable-http" : "stdio",
          backendType: "openapi",
          backendConfig,
        }),
      });
      const json = (await res.json()) as Envelope<unknown>;
      if (!res.ok || json.code !== "00000") throw new Error(json.message || "登记失败");
      toast.success(`已登记「${detail.name}」`);
      setDetail(null);
      onImported();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "登记失败");
    } finally {
      setImporting(null);
    }
  }, [detail, mcpEnv, mcpName, onImported]);

  const isSkill = source === "skill";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isSkill ? "从 SkillHub 添加技能" : "从 MCP 市场添加服务"}</DialogTitle>
          <DialogDescription>
            {isSkill
              ? "搜索并登记进本企业的技能注册表。登记之后还要放进能力包才会发给员工。"
              : "搜索 MCP 服务。选中后会带着名称和地址回到登记表单，凭据仍需你自己填。"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void search();
              }}
              placeholder={isSkill ? "搜索技能，如 Excel、财报" : "搜索 MCP 服务"}
              className="pl-9"
            />
          </div>
          <Button variant="outline" onClick={() => void search()} disabled={loading}>
            搜索
          </Button>
        </div>

        {detail ? (
          <div className="space-y-4 rounded-lg border p-4">
            <div>
              <p className="font-medium">{detail.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                连接方式已从市场带过来，确认后写进企业注册表。凭据市场不会给，得你自己填。
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">服务名</Label>
              <Input value={mcpName} onChange={(event) => setMcpName(event.target.value)} />
              <p className="text-[11px] text-muted-foreground">
                企业内唯一，员工那边按这个名字连。
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">连接</Label>
              <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">
                {detail.endpoint
                  ? detail.endpoint
                  : detail.command
                    ? [detail.command, ...detail.args].join(" ")
                    : "市场没有给连接信息，需要你手工补"}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {detail.endpoint
                  ? "托管地址，不需要在企业机器上装运行时。"
                  : "stdio 启动命令，运行时要装在跑网关的机器上。"}
              </p>
            </div>

            {detail.requiredEnv.length > 0 ? (
              <div className="space-y-2">
                <Label className="text-xs">凭据 / 环境变量</Label>
                {detail.requiredEnv.map((key) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="w-44 shrink-0 truncate font-mono text-xs">{key}</span>
                    <Input
                      type="password"
                      value={mcpEnv[key] ?? ""}
                      onChange={(event) =>
                        setMcpEnv((current) => ({ ...current, [key]: event.target.value }))
                      }
                      placeholder="留空则登记后再补"
                    />
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground">
                  入库时加密，网关代持，不会随能力包下发到员工机器上。
                </p>
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDetail(null)}>
                返回列表
              </Button>
              <Button
                size="sm"
                disabled={!mcpName.trim() || importing !== null}
                onClick={() => void registerMcp()}
              >
                {importing ? "登记中…" : "登记到企业注册表"}
              </Button>
            </div>
          </div>
        ) : unreachable ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {unreachable}
          </div>
        ) : loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-16 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">没有匹配的结果。</p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              const key = isSkill ? (item as MarketSkill).canonicalName : (item as MarketMcp).id;
              const title = isSkill
                ? (item as MarketSkill).displayName || (item as MarketSkill).name
                : (item as MarketMcp).name;
              const subtitle = isSkill
                ? `${(item as MarketSkill).author} · v${(item as MarketSkill).version}`
                : (item as MarketMcp).publisher;
              return (
                <div key={key} className="flex items-start gap-3 rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium">
                      <span className="truncate">{title}</span>
                      {!isSkill && (item as MarketMcp).verified ? (
                        <Badge variant="outline" className="font-normal">
                          已认证
                        </Badge>
                      ) : null}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {item.description || "（无说明）"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {item.detailUrl ? (
                      <Button variant="ghost" size="icon-sm" asChild title="在市场里查看">
                        <a href={item.detailUrl} target="_blank" rel="noreferrer noopener">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      disabled={importing !== null}
                      onClick={() =>
                        isSkill
                          ? void importSkill(item as MarketSkill)
                          : void openMcpDetail((item as MarketMcp).id)
                      }
                    >
                      {importing === key ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : isSkill ? (
                        "登记"
                      ) : (
                        "登记…"
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
