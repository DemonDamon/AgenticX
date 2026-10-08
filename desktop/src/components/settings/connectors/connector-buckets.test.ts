import { describe, expect, it } from "vitest";
import type { MarketplaceItem } from "../../marketplace/model";
import {
  connectionRowShape,
  connectionRowSource,
  connectionRowStatus,
  countConnectorMarketBuckets,
  filterConnectorMarketItems,
  filterMyConnectionRows,
  isCustomConnectionRow,
} from "./connector-buckets";
import {
  CONNECTOR_SUPPLY,
  RECOMMENDED_SUPPLY_IDS,
  connectorMarketSource,
  type ConnectorSupplyEntry,
} from "./connector-supply";
import type { MyConnectionRow } from "./my-connections-model";

function conn(supplyId: string, extra: Partial<MarketplaceItem> = {}): MarketplaceItem {
  return {
    key: `connector:${supplyId}`,
    kind: "connector",
    name: supplyId,
    description: "",
    installed: false,
    supplyId,
    supplyKind: supplyId.startsWith("native:") ? "native" : "mcp",
    wired: true,
    ...extra,
  };
}

const gatewayCard: MarketplaceItem = {
  key: "mcp:connector-runtime-gateway",
  kind: "mcp",
  name: "连接器网关",
  description: "",
  installed: false,
  gateway: true,
  marketSource: "enterprise",
  recommended: true,
};

const skill: MarketplaceItem = { key: "skill:x", kind: "skill", name: "x", description: "", installed: false };

describe("filterConnectorMarketItems", () => {
  const items = [
    skill,
    conn("native:github", { recommended: true }),
    conn("stub:wps", { recommended: true, wired: false }),
    conn("native:feishu", { recommended: true }),
    conn("stub:gildata", { wired: false }),
    gatewayCard,
  ];

  it("官方 = native + 官方模板，不含网关与非连接器", () => {
    expect(filterConnectorMarketItems(items, "official").map((i) => i.key)).toEqual([
      "connector:native:github",
      "connector:stub:wps",
      "connector:native:feishu",
      "connector:stub:gildata",
    ]);
  });

  it("企业 = 网关/企业提供", () => {
    expect(filterConnectorMarketItems(items, "enterprise")).toEqual([gatewayCard]);
  });

  it("企业为空时返回空（UI 显示「暂无可用连接」）", () => {
    expect(filterConnectorMarketItems(items.filter((i) => !i.gateway), "enterprise")).toEqual([]);
  });

  it("推荐 = recommended 精选，按精选表顺序", () => {
    expect(filterConnectorMarketItems(items, "recommended", RECOMMENDED_SUPPLY_IDS).map((i) => i.key)).toEqual([
      gatewayCard.key,
      "connector:native:feishu",
      "connector:native:github",
      "connector:stub:wps",
    ]);
  });

  it("推荐无精选命中时回退官方已接线条目（最多 8 个）", () => {
    const plain = Array.from({ length: 12 }, (_, i) => conn(`stub:t${i}`, { wired: i !== 0 }));
    const out = filterConnectorMarketItems([...plain, { ...gatewayCard, recommended: false }], "recommended");
    expect(out).toHaveLength(8);
    expect(out[0].key).toBe("connector:stub:t1");
    expect(out.every((i) => !i.gateway && i.wired !== false)).toBe(true);
  });

  it("未显式标 marketSource 的网关条目归企业", () => {
    const g = { ...gatewayCard, marketSource: undefined };
    expect(filterConnectorMarketItems([g], "enterprise")).toEqual([g]);
    expect(filterConnectorMarketItems([g], "official")).toEqual([]);
  });

  it("countConnectorMarketBuckets", () => {
    expect(countConnectorMarketBuckets(items)).toEqual({ recommended: 4, official: 4, enterprise: 1 });
  });
});

function row(extra: Partial<MyConnectionRow>): MyConnectionRow {
  return {
    key: "k",
    supplyId: "custom",
    kind: "mcp",
    name: "n",
    health: "connected",
    action: "mcp_remove",
    ...extra,
  };
}

describe("我的连接分桶", () => {
  const supply: ConnectorSupplyEntry[] = [
    ...CONNECTOR_SUPPLY,
    { ...(CONNECTOR_SUPPLY.find((e) => e.id === "stub:wps") as ConnectorSupplyEntry), id: "tpl:ent", marketSource: "enterprise" },
  ];
  const native = row({ kind: "native", supplyId: "native:github", action: "native_logout" });
  const gateway = row({ kind: "gateway", supplyId: "gateway:connector-runtime", action: "gateway_remove" });
  const official = row({ templateId: "stub:wps" });
  const enterprise = row({ templateId: "tpl:ent" });
  const customMcp = row({ mcpServerName: "my-mcp" }); // 连接器助手（对话）新建的 MCP 连接器
  const unknownTpl = row({ templateId: "does-not-exist" });
  const rest = row({ connectorKind: "rest", action: "rest_remove", restConnectorId: "r1", health: "degraded" });
  const db = row({ connectorKind: "database", dbType: "mysql", readOnly: true });
  const all = [native, gateway, official, enterprise, customMcp, unknownTpl, rest, db];

  it("来源：原生→官方，网关→企业，模板→模板来源，其余→自定义", () => {
    expect(all.map((r) => connectionRowSource(r, supply))).toEqual([
      "official",
      "enterprise",
      "official",
      "enterprise",
      "custom",
      "custom",
      "custom",
      "custom",
    ]);
  });

  it("全部 = 所有行；自定义连接 = 连接器助手新建的 MCP / REST / DB", () => {
    expect(filterMyConnectionRows(all, "all", supply)).toHaveLength(all.length);
    expect(filterMyConnectionRows(all, "custom", supply)).toEqual([customMcp, unknownTpl, rest, db]);
    expect(isCustomConnectionRow(native, supply)).toBe(false);
  });

  it("形态标签只给自定义实例", () => {
    expect(connectionRowShape(rest)).toBe("rest");
    expect(connectionRowShape(db)).toBe("database");
    expect(connectionRowShape(customMcp)).toBe("mcp");
    expect(connectionRowShape(native)).toBeNull();
    expect(connectionRowShape(official)).toBeNull();
    expect(connectionRowShape(gateway)).toBeNull();
  });

  it("状态：已连接 / 待填凭证（REST）/ 失效", () => {
    expect(connectionRowStatus(native)).toBe("connected");
    expect(connectionRowStatus(rest)).toBe("needs_credential");
    expect(connectionRowStatus(row({ health: "degraded" }))).toBe("invalid");
  });
});

describe("供给目录分桶字段", () => {
  it("网关条目为企业，其余为官方", () => {
    for (const e of CONNECTOR_SUPPLY) {
      expect(connectorMarketSource(e)).toBe(e.kind === "gateway" ? "enterprise" : "official");
    }
  });

  it("推荐精选表里的 id 都存在且被标 recommended", () => {
    for (const id of RECOMMENDED_SUPPLY_IDS) {
      const e = CONNECTOR_SUPPLY.find((x) => x.id === id);
      expect(e, id).toBeTruthy();
      expect(e?.recommended).toBe(true);
    }
    const flagged = CONNECTOR_SUPPLY.filter((e) => e.recommended).map((e) => e.id);
    expect(new Set(flagged)).toEqual(new Set(RECOMMENDED_SUPPLY_IDS));
  });
});
