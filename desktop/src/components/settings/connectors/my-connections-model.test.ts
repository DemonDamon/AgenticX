import { describe, expect, it } from "vitest";
import { GATEWAY_DEFAULT_SERVER_NAME } from "../../marketplace/gateway-model";
import { AGENTICX_MCP_SOURCE_CONNECTOR } from "../../../utils/mcp-remote-config";
import { GATEWAY_SUPPLY_ID } from "./connector-supply";
import {
  buildMyConnectionRows,
  configuredMcpEntriesFromDocument,
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

  it("lists custom remote MCP servers with url or connector tag", () => {
    const rows = buildMyConnectionRows({
      healthByConnectorId: {},
      configuredMcpNames: ["qingflow", GATEWAY_DEFAULT_SERVER_NAME, "github", "12306-mcp"],
      configuredMcpEntries: [
        { name: "qingflow", url: "https://mcp.example/qf", agenticxSource: AGENTICX_MCP_SOURCE_CONNECTOR },
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
    // marketplace stdio must not appear
    expect(rows.some((r) => r.mcpServerName === "12306-mcp")).toBe(false);
  });

  it("excludes stdio leftovers even when listed in configuredMcpNames", () => {
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
    expect(rows.map((r) => r.mcpServerName)).toEqual(["legacy-remote"]);
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

describe("configuredMcpEntriesFromDocument", () => {
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
