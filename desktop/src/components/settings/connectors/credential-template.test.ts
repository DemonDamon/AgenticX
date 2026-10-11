/**
 * 模板级凭证元数据（credentialLabel / credentialPlaceholder / credentialHelpUrl）与
 * 恒生聚源（stub:gildata）Comate 同款接线：官方端点预填、query_param token（Comate）、无 URL 字段。
 */
import { describe, expect, it } from "vitest";
import { authFormFields, CONNECTOR_SUPPLY, findSupplyById } from "./connector-supply";
import {
  applyCreateConnectorToMcpJson,
  buildCreateConnectorServerConfig,
  createTargetExtrasForSupply,
  credentialHelpHref,
  listConnectorTemplates,
  resolveCreateTargetWithSupply,
  resolveConnectorConnectAction,
} from "./create-connector-model";

const GILDATA_URL = "https://api.gildata.com/mcp-servers/aidata-assistant-srv-tool";
const GILDATA_HELP = "https://vcn7e7nesi3s.feishu.cn/docx/MeCmd4q0Yo7nmkx9D8IcMYbknob";
const EMPTY_DOC = `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`;

describe("credential template metadata", () => {
  it("passes label / placeholder / help URL through to the create form target", () => {
    const extras = createTargetExtrasForSupply(findSupplyById("stub:gildata"));
    expect(extras).toEqual({
      defaultMcpUrl: GILDATA_URL,
      docsUrl: "https://website.gildata.com/products/datamap",
      apiKeyQuery: "token",
      credentialLabel: "Access Token",
      credentialPlaceholder: "请填写恒生聚源下发的Access Token",
      credentialHelpUrl: GILDATA_HELP,
    });
  });

  it("prefers the credential help page over generic docs and only allows http(s)", () => {
    expect(credentialHelpHref({ credentialHelpUrl: GILDATA_HELP, docsUrl: "https://x.example/docs" })).toBe(GILDATA_HELP);
    expect(credentialHelpHref({ docsUrl: "https://x.example/docs" })).toBe("https://x.example/docs");
    expect(credentialHelpHref({ credentialHelpUrl: "javascript:alert(1)" })).toBeUndefined();
    expect(credentialHelpHref({})).toBeUndefined();
  });

  it("every help URL / official URL in the supply is https", () => {
    for (const e of CONNECTOR_SUPPLY) {
      for (const u of [e.credentialHelpUrl, e.mcpUrl, e.docsUrl]) {
        if (u) expect(u, e.id).toMatch(/^https:\/\//);
      }
    }
  });
});

describe("恒生聚源 (stub:gildata)", () => {
  const entry = findSupplyById("stub:gildata")!;

  it("is a wired, selectable create-form template (Comate query_param token)", () => {
    expect(entry.wired).toBe(true);
    expect(entry.apiKeyQuery).toBe("token");
    expect(resolveConnectorConnectAction({ kind: "connector", wired: true, authType: entry.auth })).toBe("create_form");
    const opt = listConnectorTemplates(CONNECTOR_SUPPLY).find((o) => o.entry.id === "stub:gildata");
    expect(opt?.selectable).toBe(true);
    expect(authFormFields(entry.auth)).toEqual(["name", "url", "api_key"]);
  });

  it("writes the official URL with ?token= (Comate query_param)", () => {
    const { serverName, config } = buildCreateConnectorServerConfig(
      entry.auth,
      { name: "恒生聚源MCP的连接器", url: GILDATA_URL, apiKey: "tok-123", token: "" },
      { templateId: entry.id, apiKeyQuery: entry.apiKeyQuery },
    );
    expect(serverName).toBe("gildata");
    expect(config.url).toBe(`${GILDATA_URL}?token=tok-123`);
    expect((config.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
  });

  it("creates one tagged instance from an empty mcp.json using the prefilled URL", () => {
    const res = applyCreateConnectorToMcpJson(
      EMPTY_DOC,
      entry.auth,
      { name: "恒生聚源MCP的连接器", url: entry.mcpUrl!, apiKey: "tok-123", token: "" },
      { templateId: entry.id, apiKeyQuery: entry.apiKeyQuery },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const doc = JSON.parse(res.text) as { mcpServers: Record<string, Record<string, unknown>> };
    expect(Object.keys(doc.mcpServers)).toEqual(["gildata"]);
    expect(doc.mcpServers.gildata.url).toBe(`${GILDATA_URL}?token=tok-123`);
  });
});

describe("audited token / API-key templates (official endpoint + help + label)", () => {
  const cases: Array<[string, string, "bearer" | "query" | "header", string]> = [
    ["stub:gildata", "https://api.gildata.com/mcp-servers/aidata-assistant-srv-tool", "query", "Access Token"],
    
    ["stub:lawstar", "https://api.law-star.com/mcp/point", "bearer", "Token"],
    ["stub:qingflow", "https://mcp.qingflow.com/mcp", "bearer", "Token"],
    ["stub:kuaidi100", "https://api.kuaidi100.com/mcp/streamable", "query", "快递 100 授权 key"],
    ["stub:yingmi", "https://stargate.yingmi.com/mcp/v2", "header", "APIKey"],
  ];
  for (const [id, url, style, label] of cases) {
    it(`${id} → ${style}`, () => {
      const e = findSupplyById(id)!;
      expect(e.wired).toBe(true);
      expect(e.mcpUrl).toBe(url);
      expect(e.credentialLabel).toBe(label);
      expect(e.credentialPlaceholder).toBeTruthy();
      expect(e.credentialHelpUrl).toMatch(/^https:\/\//);
      const secret = "s3cr3t-value";
      const values = { name: `${e.fallbackName}的连接器`, url: e.mcpUrl!, apiKey: secret, token: secret };
      const { config } = buildCreateConnectorServerConfig(e.auth, values, {
        templateId: e.id,
        apiKeyQuery: e.apiKeyQuery,
        credentialHeader: e.credentialHeader,
      });
      const headers = (config.headers ?? {}) as Record<string, string>;
      const meta = config._agenticx as Record<string, string>;
      if (style === "bearer") {
        expect(headers.Authorization).toBe(`Bearer ${secret}`);
        expect(String(config.url)).not.toContain(secret);
      } else if (style === "query") {
        const q = e.apiKeyQuery ?? "key";
        expect(String(config.url)).toBe(`${url}?${q}=${secret}`);
        expect(headers.Authorization).toBeUndefined();
        expect(meta.authStyle).toBe("query");
      } else {
        expect(headers["x-api-key"]).toBe(secret);
        expect(headers.Authorization).toBeUndefined();
        expect(meta).toMatchObject({ authStyle: "header", authHeader: "x-api-key" });
      }
    });
  }

  it("rejects unsafe custom header names and falls back to Bearer", () => {
    const { config } = buildCreateConnectorServerConfig(
      "custom_credential",
      { name: "x", url: "https://example.com/mcp", apiKey: "", token: "t" },
      { credentialHeader: "x-api-key\r\nInjected: 1" },
    );
    expect(config.headers).toEqual({ Authorization: "Bearer t" });
  });
});

describe("create target SSOT (market card / 从模板新建 / chat share one resolver)", () => {
  it("快递100 matches WPS Comate wording exactly", () => {
    const e = findSupplyById("stub:kuaidi100")!;
    expect(e.credentialLabel).toBe("快递 100 授权 key");
    expect(e.credentialPlaceholder).toBe("请输入快递 100 授权 key");
    expect(e.credentialHelpUrl).toBe("https://api.kuaidi100.com/document/how-to-use-mcp-service");
  });

  it("re-resolves a stale snapshot target (no extras) from the live catalog", () => {
    // 旧弹层 state 只带 name/authType/supplyId（打开时目录还没有凭证元数据）。
    const stale = { name: "快递100", authType: "api_key" as const, supplyId: "stub:kuaidi100" };
    const t = resolveCreateTargetWithSupply(stale);
    expect(t.defaultMcpUrl).toBe("https://api.kuaidi100.com/mcp/streamable");
    expect(t.apiKeyQuery).toBe("key");
    expect(t.credentialLabel).toBe("快递 100 授权 key");
    expect(t.credentialPlaceholder).toBe("请输入快递 100 授权 key");
    expect(credentialHelpHref(t)).toBe("https://api.kuaidi100.com/document/how-to-use-mcp-service");
  });

  it("catalog wins over an outdated snapshot; unknown supplyId keeps entry-point values", () => {
    const outdated = { name: "快递100", supplyId: "stub:kuaidi100", credentialLabel: "API Key" };
    expect(resolveCreateTargetWithSupply(outdated).credentialLabel).toBe("快递 100 授权 key");
    const custom = { name: "x", supplyId: "mcp:custom", credentialLabel: "Custom" };
    expect(resolveCreateTargetWithSupply(custom)).toEqual(custom);
  });
});

describe("dual-field custom headers (Comate IMA / Gangtise)", () => {
  it("stub:ima wires /mcp with ima-openapi-apikey + ima-openapi-clientid", () => {
    const e = findSupplyById("stub:ima")!;
    expect(e.wired).toBe(true);
    expect(e.mcpUrl).toBe("https://ima.qq.com/mcp");
    expect(e.credentialFields?.map((f) => f.name)).toEqual([
      "ima-openapi-apikey",
      "ima-openapi-clientid",
    ]);
    const { config } = buildCreateConnectorServerConfig(
      e.auth,
      {
        name: "IMA 知识库的连接器",
        url: e.mcpUrl!,
        apiKey: "",
        token: "",
        credentials: {
          "ima-openapi-apikey": "key-1",
          "ima-openapi-clientid": "cid-1",
        },
      },
      { templateId: e.id, credentialFields: e.credentialFields },
    );
    expect(config.url).toBe("https://ima.qq.com/mcp");
    expect(config.headers).toEqual({
      "ima-openapi-apikey": "key-1",
      "ima-openapi-clientid": "cid-1",
    });
    expect(config._agenticx).toMatchObject({
      authStyle: "headers",
      authHeaders: ["ima-openapi-apikey", "ima-openapi-clientid"],
    });
  });

  it("stub:gangtise uses Comate AK/SK dual headers (not Bearer)", () => {
    const e = findSupplyById("stub:gangtise")!;
    expect(e.wired).toBe(true);
    expect(e.mcpUrl).toBe("https://openapi.gangtise.com/application/open-mcp/");
    expect(e.credentialFields?.map((f) => f.name)).toEqual(["accessKey", "secretKey"]);
    const { config } = buildCreateConnectorServerConfig(
      e.auth,
      {
        name: "Gangtise投研的连接器",
        url: e.mcpUrl!,
        apiKey: "",
        token: "",
        credentials: { accessKey: "ak", secretKey: "sk" },
      },
      { templateId: e.id, credentialFields: e.credentialFields },
    );
    expect(config.headers).toEqual({ accessKey: "ak", secretKey: "sk" });
    expect((config.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(config._agenticx).toMatchObject({ authStyle: "headers", authHeaders: ["accessKey", "secretKey"] });
  });

  it("createTargetExtrasForSupply passes credentialFields through", () => {
    const extras = createTargetExtrasForSupply(findSupplyById("stub:ima"));
    expect(extras.defaultMcpUrl).toBe("https://ima.qq.com/mcp");
    expect(extras.credentialFields?.map((f) => f.name)).toEqual([
      "ima-openapi-apikey",
      "ima-openapi-clientid",
    ]);
  });
});
