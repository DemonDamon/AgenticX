/**
 * 官方远程 MCP + OAuth 2.1 动态客户端注册（mcp_oauth）：供给表、新建表单载荷、
 * 「我的连接」待授权态、主进程令牌文件视图（只回传布尔，不读出令牌）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  mcpOauthSafeName,
  mcpOauthTokenPath,
  readMcpOauthAuthorized,
  resetMcpOauthTokens,
} from "../../../../electron/mcp-oauth-store";
import { buildConnectorSupplyItems } from "../../marketplace/model";
import { connectionRowStatus } from "./connector-buckets";
import { connectorSupplyDisplay } from "./connector-display";
import { authFormFields, CONNECTOR_SUPPLY, findSupplyById, supportsCreateConnectorForm } from "./connector-supply";
import {
  applyCreateConnectorToMcpJson,
  buildCreateConnectorServerConfig,
  createTargetExtrasForSupply,
  isMcpOauthServerConfig,
  listConnectorTemplates,
  resolveConnectorConnectAction,
  validateCreateConnectorForm,
} from "./create-connector-model";
import { buildMyConnectionRows, configuredMcpEntriesFromDocument } from "./my-connections-model";

const EMPTY_DOC = `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`;
const OAUTH_IDS = [
  "stub:tencent-docs",
  "native:notion",
  "stub:linear",
  "stub:cloudflare",
  "stub:tianyancha",
  "stub:qichacha",
] as const;

describe("mcp_oauth supply entries", () => {
  it("wires verified official OAuth-DCR endpoints as name-only templates", () => {
    for (const id of OAUTH_IDS) {
      const e = findSupplyById(id)!;
      expect(e, id).toBeTruthy();
      expect(e.auth, id).toBe("mcp_oauth");
      expect(e.wired, id).toBe(true);
      expect(e.kind, id).toBe("mcp");
      expect(e.connectorId, id).toBeUndefined();
      expect(e.authFormHint, id).toBe("oauth_dcr");
      expect(e.mcpUrl, id).toMatch(/^https:\/\//);
    }
    expect(findSupplyById("stub:tencent-docs")!.mcpUrl).toBe("https://docs.qq.com/openapi/mcp");
    expect(authFormFields("mcp_oauth")).toEqual(["name", "url"]);
    expect(supportsCreateConnectorForm("mcp_oauth")).toBe(true);
    expect(resolveConnectorConnectAction({ wired: true, authType: "mcp_oauth" })).toBe("create_form");
    expect(resolveConnectorConnectAction({ wired: false, authType: "mcp_oauth" })).toBe("create_form");
    const opts = listConnectorTemplates(CONNECTOR_SUPPLY);
    expect(opts.find((o) => o.entry.id === "stub:tencent-docs")?.action).toBe("create_form");
    expect(opts.find((o) => o.entry.id === "native:notion")?.selectable).toBe(true);
  });

  it("keeps Notion's catalog name after it moved to the official remote MCP", () => {
    expect(connectorSupplyDisplay(findSupplyById("native:notion")!).name).toBe("Notion");
  });

  it("market cards route wired templates to the create form (not 暂未接线)", () => {
    const items = buildConnectorSupplyItems(
      CONNECTOR_SUPPLY.filter((e) => e.id === "stub:tencent-docs" || e.id === "stub:wps"),
      { wiredOnly: false },
    );
    const td = items.find((i) => i.supplyId === "stub:tencent-docs")!;
    expect(td.wired).toBe(true);
    expect(td.health).toBe("disconnected");
    expect(resolveConnectorConnectAction(td)).toBe("create_form");
    expect(items.find((i) => i.supplyId === "stub:wps")!.health).toBe("unwired");
  });

  it("prefills official URL / docs / query-key param into the create target", () => {
    expect(createTargetExtrasForSupply(findSupplyById("stub:tencent-docs"))).toEqual({
      defaultMcpUrl: "https://docs.qq.com/openapi/mcp",
      docsUrl: "https://docs.qq.com/open/document/saas/mcp.html",
    });
    expect(createTargetExtrasForSupply(findSupplyById("stub:amap"))).toMatchObject({
      defaultMcpUrl: "https://mcp.amap.com/mcp",
      apiKeyQuery: "key",
    });
    expect(createTargetExtrasForSupply(undefined)).toEqual({});
  });
});

describe("mcp_oauth create payload", () => {
  const values = { name: "腾讯文档的连接器", url: "https://docs.qq.com/openapi/mcp", apiKey: "", token: "" };

  it("needs only a name (URL is prefilled) and never a secret", () => {
    expect(validateCreateConnectorForm("mcp_oauth", values)).toEqual({});
    expect(validateCreateConnectorForm("mcp_oauth", { ...values, name: "" }).name).toBe("required_name");
  });

  it("writes url + oauth:true, no headers, tagged with the template", () => {
    const { serverName, config } = buildCreateConnectorServerConfig(
      "mcp_oauth",
      { ...values, token: "should-be-ignored", apiKey: "ignored-too" },
      { templateId: "stub:tencent-docs" },
    );
    expect(serverName).toBe("tencent-docs");
    expect(config.url).toBe("https://docs.qq.com/openapi/mcp");
    expect(config.oauth).toBe(true);
    expect(config.headers).toBeUndefined();
    expect(JSON.stringify(config)).not.toContain("ignored");
    expect(config._agenticx).toMatchObject({
      templateId: "stub:tencent-docs",
      displayName: "腾讯文档的连接器",
      source: "connector",
      authStyle: "none",
    });
    expect(isMcpOauthServerConfig(config)).toBe(true);
  });

  it("dedupes per template: second create returns exists, overwrite keeps one entry", () => {
    const first = applyCreateConnectorToMcpJson(EMPTY_DOC, "mcp_oauth", values, { templateId: "stub:tencent-docs" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = applyCreateConnectorToMcpJson(first.text, "mcp_oauth", { ...values, name: "另一个" }, {
      templateId: "stub:tencent-docs",
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toBe("exists");
    const same = applyCreateConnectorToMcpJson(first.text, "mcp_oauth", values, {
      templateId: "stub:tencent-docs",
      overwrite: true,
    });
    expect(same.ok && same.unchanged).toBe(true);
    const entries = configuredMcpEntriesFromDocument(JSON.parse(first.text));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: "tencent-docs", oauth: true, templateId: "stub:tencent-docs" });
  });

  it("puts query-style API keys into the URL (高德 key / 腾讯地图 key&format=0), not a Bearer header", () => {
    const amap = buildCreateConnectorServerConfig(
      "api_key",
      { name: "高德", url: "https://mcp.amap.com/mcp", apiKey: "K123", token: "" },
      { templateId: "stub:amap", apiKeyQuery: "key" },
    ).config;
    expect(amap.url).toBe("https://mcp.amap.com/mcp?key=K123");
    expect(amap.headers).toBeUndefined();
    expect(amap.oauth).toBeUndefined();
    expect(amap._agenticx).toMatchObject({ authStyle: "query", authQuery: "key" });
    const tmap = buildCreateConnectorServerConfig(
      "api_key",
      { name: "腾讯地图", url: "https://mcp.map.qq.com/mcp?format=0", apiKey: "Q", token: "" },
      { templateId: "stub:tencent-maps", apiKeyQuery: "key" },
    ).config;
    expect(tmap.url).toBe("https://mcp.map.qq.com/mcp?format=0&key=Q");
  });
});

describe("我的连接：待授权 / 已连接", () => {
  const created = applyCreateConnectorToMcpJson(
    EMPTY_DOC,
    "mcp_oauth",
    { name: "腾讯文档的连接器", url: "https://docs.qq.com/openapi/mcp", apiKey: "", token: "" },
    { templateId: "stub:tencent-docs" },
  );
  const doc = JSON.parse(created.ok ? created.text : "{}");
  const entries = configuredMcpEntriesFromDocument(doc);
  const build = (oauthAuthorized?: Record<string, boolean>) =>
    buildMyConnectionRows({
      healthByConnectorId: {},
      configuredMcpNames: entries.map((e) => e.name),
      configuredMcpEntries: entries,
      oauthAuthorized,
    });

  it("shows 待授权 until tokens exist, then 已连接", () => {
    const pending = build({ "tencent-docs": false });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ oauth: true, health: "degraded", supplyId: "stub:tencent-docs" });
    expect(connectionRowStatus(pending[0]!)).toBe("needs_auth");
    const ok = build({ "tencent-docs": true });
    expect(connectionRowStatus(ok[0]!)).toBe("connected");
  });

  it("does not claim 待授权 when the state is unknown (old main process)", () => {
    expect(connectionRowStatus(build(undefined)[0]!)).toBe("connected");
  });
});

describe("electron mcp-oauth-store (token file view)", () => {
  it("mirrors the Python _safe_name", () => {
    expect(mcpOauthSafeName("tencent-docs")).toBe("tencent-docs");
    expect(mcpOauthSafeName("a.b/c d")).toBe("a_b_c_d");
    expect(mcpOauthSafeName("")).toBe("server");
    expect(mcpOauthSafeName("x".repeat(100))).toHaveLength(80);
  });

  it("reports only booleans and resets tokens while keeping the DCR client", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "agx-oauth-"));
    try {
      const file = mcpOauthTokenPath("tencent-docs", home);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({
          redirect_port: 43210,
          client_info: { client_id: "cid" },
          tokens: { access_token: "secret-at", token_type: "Bearer" },
        }),
        { mode: 0o600 },
      );
      const state = readMcpOauthAuthorized(["tencent-docs", "linear"], home);
      expect(state).toEqual({ "tencent-docs": true, linear: false });
      expect(JSON.stringify(state)).not.toContain("secret");

      expect(resetMcpOauthTokens("tencent-docs", home)).toBe(true);
      const after = JSON.parse(fs.readFileSync(file, "utf-8"));
      expect(after.tokens).toBeUndefined();
      expect(after.client_info).toEqual({ client_id: "cid" });
      expect(after.redirect_port).toBe(43210);
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(readMcpOauthAuthorized(["tencent-docs"], home)["tencent-docs"]).toBe(false);
      expect(resetMcpOauthTokens("tencent-docs", home)).toBe(false);
      expect(resetMcpOauthTokens("missing", home)).toBe(false);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
