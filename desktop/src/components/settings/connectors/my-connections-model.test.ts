import { describe, expect, it } from "vitest";
import { GATEWAY_DEFAULT_SERVER_NAME, GATEWAY_LOCAL_SERVER_NAME } from "../../marketplace/gateway-model";
import {
  AGENTICX_MCP_SOURCE_CONNECTOR,
  isConnectorMcpConfig,
  isConnectorMcpEntry,
} from "../../../utils/mcp-remote-config";
import { GATEWAY_SUPPLY_ID } from "./connector-supply";
import {
  buildMyConnectionRows,
  configuredMcpEntriesFromDocument,
  connectedSupplyIds,
  findConnectionForSupply,
  listPlainMcpServerNames,
  removeMcpServerFromDocument,
} from "./my-connections-model";

describe("buildMyConnectionRows", () => {
  it("lists native connected and degraded, skips disconnected", () => {
    const rows = buildMyConnectionRows({
      healthByConnectorId: {
        github: "degraded",
        feishu: "connected",
        wecom: "disconnected",
      },
      accountsByConnectorId: { github: "DemonDamon", feishu: "李四" },
      configuredMcpNames: ["github"],
      gatewayInstalled: false,
      displayNames: {
        "native:github": "GitHub",
        "native:feishu": "飞书",
        "native:wecom": "企业微信",
      },
    });
    expect(rows.map((r) => r.connectorId)).toEqual(["github", "feishu"]);
    expect(rows.find((r) => r.connectorId === "github")?.health).toBe("degraded");
    expect(rows.find((r) => r.connectorId === "github")?.action).toBe("native_logout");
    expect(rows.find((r) => r.connectorId === "github")?.detail).toBe("DemonDamon");
    expect(rows.find((r) => r.connectorId === "feishu")?.action).toBe("native_logout");
  });

  it("maps tapd to mcp_remove and gateway to gateway_remove", () => {
    const rows = buildMyConnectionRows({
      healthByConnectorId: { tapd: "connected" },
      configuredMcpNames: ["tapd", GATEWAY_DEFAULT_SERVER_NAME],
      gatewayInstalled: true,
      displayNames: {
        "native:tapd": "TAPD",
        [GATEWAY_SUPPLY_ID]: "连接器网关",
      },
    });
    expect(rows.find((r) => r.connectorId === "tapd")?.action).toBe("mcp_remove");
    expect(rows.find((r) => r.kind === "gateway")?.action).toBe("gateway_remove");
    expect(rows.find((r) => r.kind === "gateway")?.mcpServerName).toBe(GATEWAY_DEFAULT_SERVER_NAME);
  });

  it("lists connector-assistant MCP instances, not generic MCP servers", () => {
    const rows = buildMyConnectionRows({
      healthByConnectorId: {},
      configuredMcpNames: ["qingflow", "old-custom", "plain-remote", GATEWAY_DEFAULT_SERVER_NAME, "github", "12306-mcp"],
      configuredMcpEntries: [
        {
          name: "qingflow",
          url: "https://mcp.example/qf",
          agenticxSource: AGENTICX_MCP_SOURCE_CONNECTOR,
          createdVia: "chat",
        },
        // 旧「新建自定义 MCP」打过 source 标但不是连接器助手创建 → 通用 MCP
        { name: "old-custom", url: "https://old.example/mcp", agenticxSource: AGENTICX_MCP_SOURCE_CONNECTOR, displayName: "old" },
        // 手动添加 / 导入的远程 MCP → 通用 MCP
        { name: "plain-remote", url: "https://plain.example/mcp" },
        { name: GATEWAY_DEFAULT_SERVER_NAME, url: "http://127.0.0.1:9/mcp" },
        { name: "github", command: "docker" },
        { name: "12306-mcp", command: "npx" },
      ],
      gatewayInstalled: true,
      displayNames: { [GATEWAY_SUPPLY_ID]: "连接器网关" },
    });
    const custom = rows.find((r) => r.mcpServerName === "qingflow");
    expect(custom?.kind).toBe("mcp");
    expect(custom?.action).toBe("mcp_remove");
    expect(custom?.health).toBe("connected");
    expect(custom?.detail).toBe("mcp.example");
    // github without native health is not a standalone custom row (claimed by native sync name)
    expect(rows.some((r) => r.key === "mcp:github")).toBe(false);
    // marketplace stdio / generic MCP must not appear
    expect(rows.some((r) => r.mcpServerName === "12306-mcp")).toBe(false);
    expect(rows.some((r) => r.mcpServerName === "old-custom")).toBe(false);
    expect(rows.some((r) => r.mcpServerName === "plain-remote")).toBe(false);
  });

  it("excludes generic MCP servers (stdio and untagged remotes) even when listed in configuredMcpNames", () => {
    const rows = buildMyConnectionRows({
      healthByConnectorId: {},
      configuredMcpNames: ["bing-search", "memory", "browser-use", "legacy-remote"],
      configuredMcpEntries: [
        { name: "bing-search", command: "npx" },
        { name: "memory", command: "uvx" },
        { name: "browser-use", command: "uvx" },
        { name: "legacy-remote", url: "https://mcp.example/legacy" },
      ],
      gatewayInstalled: false,
    });
    expect(rows).toEqual([]);
  });

  it("does not dump bare names without entry metadata", () => {
    const rows = buildMyConnectionRows({
      healthByConnectorId: {},
      configuredMcpNames: ["qingflow", "12306-mcp", "bing-search"],
      gatewayInstalled: false,
    });
    expect(rows).toEqual([]);
  });

  it("filters by query", () => {
    const rows = buildMyConnectionRows({
      healthByConnectorId: { github: "connected", feishu: "connected" },
      configuredMcpNames: [],
      displayNames: {
        "native:github": "GitHub",
        "native:feishu": "飞书",
      },
      query: "git",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.connectorId).toBe("github");
  });
});

describe("buildMyConnectionRows dedupe (single source of truth)", () => {
  const doc = {
    mcpServers: {
      qingflow: {
        url: "https://mcp.example/qf",
        headers: { Authorization: "Bearer tok" },
        _agenticx: { source: "connector", templateId: "stub:qingflow", displayName: "轻流的连接器" },
      },
      // 历史重复：同模板 + 同凭证（Comate 式重复实例）
      "connector-abc": {
        url: "https://mcp.example/qf/",
        headers: { Authorization: "Bearer tok" },
        _agenticx: { source: "connector", templateId: "stub:qingflow", displayName: "轻流的连接器" },
      },
      // 连接器助手创建（无模板）但同端点同凭证的重复条目
      "legacy-a": {
        url: "https://legacy.example/mcp",
        headers: { Authorization: "Bearer L" },
        _agenticx: { source: "connector", createdVia: "chat" },
      },
      "legacy-b": {
        url: "https://legacy.example/mcp/",
        headers: { Authorization: "Bearer L" },
        _agenticx: { source: "connector", createdVia: "chat" },
      },
      // 通用 MCP（未打标）不进「我的连接」
      "plain-remote": { url: "https://plain.example/mcp", headers: { Authorization: "Bearer P" } },
    },
  };
  const entries = configuredMcpEntriesFromDocument(doc);
  const names = entries.map((e) => e.name);

  it("collapses same template + same credential into one row", () => {
    const rows = buildMyConnectionRows({
      healthByConnectorId: {},
      configuredMcpNames: names,
      configuredMcpEntries: entries,
      gatewayInstalled: false,
    });
    const qf = rows.filter((r) => r.supplyId === "stub:qingflow");
    expect(qf).toHaveLength(1);
    expect(qf[0]?.name).toBe("轻流的连接器");
    expect(qf[0]?.templateId).toBe("stub:qingflow");
    expect(qf[0]?.iconSrc).toBeTruthy();
    expect(qf[0]?.mcpServerNames?.sort()).toEqual(["connector-abc", "qingflow"]);
    const legacy = rows.filter((r) => r.mcpServerNames?.some((n) => n.startsWith("legacy-")));
    expect(legacy).toHaveLength(1);
    expect(legacy[0]?.mcpServerNames?.sort()).toEqual(["legacy-a", "legacy-b"]);
    expect(rows).toHaveLength(2);
  });

  it("keeps different credentials apart but never with identical names", () => {
    const rows = buildMyConnectionRows({
      healthByConnectorId: {},
      configuredMcpNames: ["qf-a", "qf-b"],
      configuredMcpEntries: [
        {
          name: "qf-a",
          url: "https://mcp.example/qf",
          agenticxSource: AGENTICX_MCP_SOURCE_CONNECTOR,
          templateId: "stub:qingflow",
          displayName: "轻流的连接器",
          credentialFingerprint: "fp-a",
        },
        {
          name: "qf-b",
          url: "https://mcp.example/qf",
          agenticxSource: AGENTICX_MCP_SOURCE_CONNECTOR,
          templateId: "stub:qingflow",
          displayName: "轻流的连接器",
          credentialFingerprint: "fp-b",
        },
      ],
      gatewayInstalled: false,
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.name)).size).toBe(2);
    expect(rows.map((r) => r.name)).toContain("轻流的连接器 (2)");
  });

  it("folds a template instance of a connected native connector into the native row", () => {
    const rows = buildMyConnectionRows({
      healthByConnectorId: { feishu: "connected" },
      configuredMcpNames: ["feishu-remote"],
      configuredMcpEntries: [
        {
          name: "feishu-remote",
          url: "https://feishu.example/mcp",
          agenticxSource: AGENTICX_MCP_SOURCE_CONNECTOR,
          templateId: "native:feishu",
        },
      ],
      displayNames: { "native:feishu": "飞书" },
    });
    expect(rows.filter((r) => r.supplyId === "native:feishu")).toHaveLength(1);
    expect(rows.find((r) => r.supplyId === "native:feishu")?.mcpServerNames).toEqual(["feishu-remote"]);
    expect(rows).toHaveLength(1);
  });

  it("exposes supply ids for marketplace cards / create dedupe", () => {
    const rows = buildMyConnectionRows({
      healthByConnectorId: { github: "connected" },
      configuredMcpNames: names,
      configuredMcpEntries: entries,
    });
    const ids = connectedSupplyIds(rows);
    expect(ids.has("stub:qingflow")).toBe(true);
    expect(ids.has("native:github")).toBe(true);
    expect(ids.has("stub:gitlab")).toBe(false);
    expect(findConnectionForSupply(rows, "stub:qingflow")?.name).toBe("轻流的连接器");
    expect(findConnectionForSupply(rows, undefined)).toBeUndefined();
  });
});

describe("configuredMcpEntriesFromDocument", () => {
  it("reads template meta and credential fingerprint without exposing secrets", () => {
    const [e] = configuredMcpEntriesFromDocument({
      mcpServers: {
        qingflow: {
          url: "https://mcp.example/qf",
          headers: { Authorization: "Bearer super-secret" },
          _agenticx: { source: "connector", templateId: "stub:qingflow", displayName: "轻流的连接器" },
        },
      },
    });
    expect(e).toMatchObject({ templateId: "stub:qingflow", displayName: "轻流的连接器" });
    expect(e?.credentialFingerprint).toMatch(/^fp-/);
    expect(JSON.stringify(e)).not.toContain("super-secret");
  });

  it("reads url/command and _agenticx.source", () => {
    const entries = configuredMcpEntriesFromDocument({
      mcpServers: {
        qingflow: {
          url: "https://mcp.example/qf",
          _agenticx: { source: "connector" },
        },
        "12306-mcp": { command: "npx", args: ["-y", "12306-mcp"] },
      },
    });
    expect(entries.find((e) => e.name === "qingflow")).toMatchObject({
      url: "https://mcp.example/qf",
      agenticxSource: "connector",
    });
    expect(entries.find((e) => e.name === "12306-mcp")?.command).toBe("npx");
  });
});

describe("removeMcpServerFromDocument", () => {
  it("removes nested mcpServers entry", () => {
    const { document, removed } = removeMcpServerFromDocument(
      { mcpServers: { github: { command: "docker" }, other: {} } },
      "github",
    );
    expect(removed).toBe(true);
    expect(document.mcpServers).toEqual({ other: {} });
  });

  it("no-ops when missing", () => {
    const doc = { mcpServers: { a: {} } };
    const { removed } = removeMcpServerFromDocument(doc, "missing");
    expect(removed).toBe(false);
  });
});

describe("buildMyConnectionRows: database + REST kinds", () => {
  const doc = {
    mcpServers: {
      "shop-db": {
        command: "/usr/bin/python3",
        args: ["-m", "agenticx.connectors.db_mcp"],
        env: { AGX_DB_TYPE: "sqlite", AGX_DB_PATH: "/tmp/shop.db" },
        _agenticx: { source: AGENTICX_MCP_SOURCE_CONNECTOR, kind: "database", dbType: "sqlite", displayName: "Shop DB", templateId: "db:sqlite" },
      },
      "pg-rw": {
        command: "/usr/bin/python3",
        env: { AGX_DB_TYPE: "postgresql", AGX_DB_ALLOW_WRITES: "1" },
        _agenticx: { source: AGENTICX_MCP_SOURCE_CONNECTOR, kind: "database", dbType: "postgresql", displayName: "PG" },
      },
      [GATEWAY_LOCAL_SERVER_NAME]: { url: "http://127.0.0.1:7788/mcp", headers: { Authorization: "Bearer x" } },
      [GATEWAY_DEFAULT_SERVER_NAME]: { url: "https://gw.corp.example/mcp" },
      "plain-stdio": { command: "npx", args: ["x"] },
    },
  };

  it("lists each database once with kind, db type and read-only flag; never the local gateway entry", () => {
    const entries = configuredMcpEntriesFromDocument(doc);
    const rows = buildMyConnectionRows({
      healthByConnectorId: {},
      configuredMcpNames: entries.map((e) => e.name),
      configuredMcpEntries: entries,
      restConnectors: [
        { id: "mock-shop", name: "Mock Shop", baseUrl: "http://127.0.0.1:9000/api", hasCredential: true },
        { id: "signed", name: "Signed", hasCredential: false },
        { id: "mock-shop", name: "Mock Shop", hasCredential: true },
      ],
    });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    expect(rows.filter((r) => r.mcpServerName === GATEWAY_LOCAL_SERVER_NAME && !r.restConnectorId)).toEqual([]);
    expect(byKey.get("mcp:plain-stdio")).toBeUndefined();
    const db = byKey.get("mcp:shop-db");
    expect(db).toMatchObject({ name: "Shop DB", connectorKind: "database", dbType: "sqlite", readOnly: true, detail: "SQLite", action: "mcp_remove" });
    expect(db?.iconSrc).toBeTruthy();
    expect(byKey.get("mcp:pg-rw")).toMatchObject({ connectorKind: "database", readOnly: false, detail: "PostgreSQL" });
    const rest = rows.filter((r) => r.connectorKind === "rest");
    expect(rest.map((r) => [r.restConnectorId, r.health, r.action, r.mcpServerName])).toEqual([
      ["mock-shop", "connected", "rest_remove", GATEWAY_LOCAL_SERVER_NAME],
      ["signed", "degraded", "rest_remove", GATEWAY_LOCAL_SERVER_NAME],
    ]);
    expect(byKey.get("rest:mock-shop")?.detail).toBe("127.0.0.1:9000");
    // gateway itself still appears exactly once
    expect(rows.filter((r) => r.supplyId === GATEWAY_SUPPLY_ID)).toHaveLength(1);
    expect(new Set(rows.map((r) => r.name)).size).toBe(rows.length);
  });

  it("filters REST and database rows by query", () => {
    const entries = configuredMcpEntriesFromDocument(doc);
    const rows = buildMyConnectionRows({
      healthByConnectorId: {},
      configuredMcpNames: entries.map((e) => e.name),
      configuredMcpEntries: entries,
      restConnectors: [{ id: "mock-shop", name: "Mock Shop", hasCredential: true }],
      query: "shop",
    });
    expect(rows.map((r) => r.key).sort()).toEqual(["mcp:shop-db", "rest:mock-shop"]);
  });
});


describe("connector vs generic MCP classification", () => {
  it("isConnectorMcpEntry: template / chat-created / database are connectors", () => {
    expect(isConnectorMcpEntry({ templateId: "stub:wecom-cli" })).toBe(true);
    expect(isConnectorMcpEntry({ agenticxSource: AGENTICX_MCP_SOURCE_CONNECTOR, createdVia: "chat" })).toBe(true);
    expect(isConnectorMcpEntry({ agenticxSource: AGENTICX_MCP_SOURCE_CONNECTOR, connectorKind: "database" })).toBe(true);
    // 旧「新建自定义 MCP」只打 source 标 → 通用 MCP
    expect(isConnectorMcpEntry({ agenticxSource: AGENTICX_MCP_SOURCE_CONNECTOR })).toBe(false);
    expect(isConnectorMcpEntry({})).toBe(false);
    expect(isConnectorMcpEntry({ createdVia: "chat" })).toBe(false);
  });

  it("isConnectorMcpConfig reads raw mcp.json entries", () => {
    expect(isConnectorMcpConfig({ url: "https://x/mcp" })).toBe(false);
    expect(isConnectorMcpConfig({ url: "https://x/mcp", _agenticx: { source: "connector", displayName: "x" } })).toBe(false);
    expect(isConnectorMcpConfig({ url: "https://x/mcp", _agenticx: { source: "connector", createdVia: "chat" } })).toBe(true);
    expect(isConnectorMcpConfig({ command: "npx", _agenticx: { source: "connector", templateId: "stub:dingtalk" } })).toBe(true);
    expect(isConnectorMcpConfig(null)).toBe(false);
  });

  it("template-backed MCP (stdio CLI) stays in 我的连接", () => {
    const entries = configuredMcpEntriesFromDocument({
      mcpServers: {
        dingtalk: { command: "npx", args: ["dws"], _agenticx: { source: "connector", templateId: "stub:dingtalk" } },
        context7: { url: "https://mcp.context7.com/mcp" },
      },
    });
    const rows = buildMyConnectionRows({
      healthByConnectorId: {},
      configuredMcpNames: entries.map((e) => e.name),
      configuredMcpEntries: entries,
      gatewayInstalled: false,
    });
    expect(rows.map((r) => r.mcpServerName)).toEqual(["dingtalk"]);
    expect(rows[0]?.templateId).toBe("stub:dingtalk");
  });

  it("listPlainMcpServerNames: generic MCP only (no gateway / native sync / connectors)", () => {
    const entries = configuredMcpEntriesFromDocument({
      mcpServers: {
        context7: { url: "https://mcp.context7.com/mcp" },
        "old-custom": { url: "https://old.example/mcp", _agenticx: { source: "connector", displayName: "old" } },
        memory: { command: "uvx" },
        dingtalk: { command: "npx", _agenticx: { source: "connector", templateId: "stub:dingtalk" } },
        "chat-mcp": { url: "https://c.example/mcp", _agenticx: { source: "connector", createdVia: "chat" } },
        db: { command: "agx", _agenticx: { source: "connector", kind: "database", templateId: "db:sqlite" } },
        [GATEWAY_DEFAULT_SERVER_NAME]: { url: "http://127.0.0.1:1/mcp" },
        [GATEWAY_LOCAL_SERVER_NAME]: { url: "http://127.0.0.1:2/mcp" },
        github: { command: "docker" },
      },
    });
    expect(listPlainMcpServerNames(["status-only"], entries)).toEqual(["context7", "memory", "old-custom", "status-only"]);
  });
});
