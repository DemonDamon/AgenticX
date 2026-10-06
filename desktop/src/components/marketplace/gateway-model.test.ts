import { describe, expect, it } from "vitest";
import {
  GATEWAY_DEFAULT_SERVER_NAME,
  applyGatewayToMcpJson,
  buildGatewayMarketItem,
  buildGatewayServerConfig,
  isGatewayInstalled,
  normalizeGatewayUrl,
  resolveGatewayServerName,
  type GatewayForm,
} from "./gateway-model";

/** 托管形态表单(与数据文件默认值一致)。 */
const hostedForm: GatewayForm = {
  mode: "hosted",
  url: "https://connector.oomol.com/mcp",
  token: "",
  serverName: "",
};

/** 自建形态表单(带 token)。 */
const selfForm: GatewayForm = {
  mode: "self",
  url: "http://127.0.0.1:8787/mcp",
  token: "pat-secret",
  serverName: "my-gateway",
};

describe("normalizeGatewayUrl", () => {
  it("passes through a well-formed /mcp endpoint", () => {
    expect(normalizeGatewayUrl("https://connector.oomol.com/mcp")).toBe(
      "https://connector.oomol.com/mcp",
    );
  });

  it("strips trailing slashes", () => {
    expect(normalizeGatewayUrl("https://connector.oomol.com/mcp/")).toBe(
      "https://connector.oomol.com/mcp",
    );
    expect(normalizeGatewayUrl("https://connector.oomol.com/mcp///")).toBe(
      "https://connector.oomol.com/mcp",
    );
  });

  it("appends /mcp when the path is empty or root-only", () => {
    expect(normalizeGatewayUrl("https://connector.oomol.com")).toBe(
      "https://connector.oomol.com/mcp",
    );
    expect(normalizeGatewayUrl("http://127.0.0.1:8787/")).toBe("http://127.0.0.1:8787/mcp");
  });

  it("defaults the scheme to https for bare hosts", () => {
    expect(normalizeGatewayUrl("connector.oomol.com")).toBe("https://connector.oomol.com/mcp");
  });

  it("keeps custom non-root paths untouched", () => {
    expect(normalizeGatewayUrl("https://gw.internal/api/mcp")).toBe("https://gw.internal/api/mcp");
  });

  it("rejects empty or whitespace-only input", () => {
    expect(normalizeGatewayUrl("")).toBeNull();
    expect(normalizeGatewayUrl("   ")).toBeNull();
  });

  it("rejects non-http(s) schemes", () => {
    expect(normalizeGatewayUrl("ftp://connector.oomol.com")).toBeNull();
    expect(normalizeGatewayUrl("file:///etc/passwd")).toBeNull();
  });

  it("rejects unparseable urls", () => {
    expect(normalizeGatewayUrl("not a url")).toBeNull();
  });
});

describe("resolveGatewayServerName", () => {
  it("falls back to the default server name when blank", () => {
    expect(resolveGatewayServerName({ ...hostedForm, serverName: "" })).toBe(
      GATEWAY_DEFAULT_SERVER_NAME,
    );
    expect(resolveGatewayServerName({ ...hostedForm, serverName: "   " })).toBe(
      GATEWAY_DEFAULT_SERVER_NAME,
    );
  });

  it("trims a custom server name", () => {
    expect(resolveGatewayServerName({ ...selfForm, serverName: "  my-gateway  " })).toBe(
      "my-gateway",
    );
  });
});

describe("buildGatewayServerConfig", () => {
  it("builds a streamable-http payload without headers when token is empty", () => {
    const res = buildGatewayServerConfig(hostedForm);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.serverName).toBe(GATEWAY_DEFAULT_SERVER_NAME);
    expect(res.config).toEqual({ url: "https://connector.oomol.com/mcp" });
  });

  it("adds a Bearer Authorization header when token is present", () => {
    const res = buildGatewayServerConfig(selfForm);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.serverName).toBe("my-gateway");
    expect(res.config).toEqual({
      url: "http://127.0.0.1:8787/mcp",
      headers: { Authorization: "Bearer pat-secret" },
    });
  });

  it("normalizes the url before building the payload", () => {
    const res = buildGatewayServerConfig({ ...hostedForm, url: "connector.oomol.com/" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config.url).toBe("https://connector.oomol.com/mcp");
  });

  it("fails with invalid_url for unusable urls", () => {
    const res = buildGatewayServerConfig({ ...hostedForm, url: "ftp://x" });
    expect(res).toEqual({ ok: false, error: "invalid_url" });
  });
});

describe("applyGatewayToMcpJson", () => {
  it("creates mcpServers in an empty document", () => {
    const res = applyGatewayToMcpJson("{}", hostedForm);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.existed).toBe(false);
    expect(JSON.parse(res.text)).toEqual({
      mcpServers: {
        [GATEWAY_DEFAULT_SERVER_NAME]: { url: "https://connector.oomol.com/mcp" },
      },
    });
  });

  it("preserves sibling servers and unrelated top-level keys", () => {
    const doc = JSON.stringify({
      version: 2,
      mcpServers: { github: { url: "https://mcp.github.com/sse" } },
    });
    const res = applyGatewayToMcpJson(doc, selfForm);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const parsed = JSON.parse(res.text) as {
      version: number;
      mcpServers: Record<string, unknown>;
    };
    expect(parsed.version).toBe(2);
    expect(parsed.mcpServers.github).toEqual({ url: "https://mcp.github.com/sse" });
    expect(parsed.mcpServers["my-gateway"]).toEqual({
      url: "http://127.0.0.1:8787/mcp",
      headers: { Authorization: "Bearer pat-secret" },
    });
  });

  it("reports existed=true when overwriting the same server name", () => {
    const doc = JSON.stringify({
      mcpServers: { [GATEWAY_DEFAULT_SERVER_NAME]: { url: "https://old.example/mcp" } },
    });
    const res = applyGatewayToMcpJson(doc, hostedForm);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.existed).toBe(true);
    const parsed = JSON.parse(res.text) as { mcpServers: Record<string, unknown> };
    expect((parsed.mcpServers[GATEWAY_DEFAULT_SERVER_NAME] as { url: string }).url).toBe(
      "https://connector.oomol.com/mcp",
    );
  });

  it("writes pretty-printed json with a trailing newline", () => {
    const res = applyGatewayToMcpJson("{}", hostedForm);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.text.endsWith("\n")).toBe(true);
    expect(res.text.split("\n").length).toBeGreaterThan(3);
  });

  it("fails with invalid_json for corrupt documents", () => {
    const res = applyGatewayToMcpJson("{ not json", hostedForm);
    expect(res).toEqual({ ok: false, error: "invalid_json" });
  });

  it("propagates invalid_url", () => {
    const res = applyGatewayToMcpJson("{}", { ...hostedForm, url: "" });
    expect(res).toEqual({ ok: false, error: "invalid_url" });
  });
});

describe("isGatewayInstalled", () => {
  it("matches the configured roster case-insensitively", () => {
    expect(isGatewayInstalled(new Set(["Open-Connector"]), GATEWAY_DEFAULT_SERVER_NAME)).toBe(true);
    expect(isGatewayInstalled(new Set(["github"]), GATEWAY_DEFAULT_SERVER_NAME)).toBe(false);
    expect(isGatewayInstalled(new Set(["my-gateway"]), "my-gateway")).toBe(true);
  });
});

describe("buildGatewayMarketItem", () => {
  it("builds the featured gateway card as a special mcp item", () => {
    const item = buildGatewayMarketItem({
      name: "连接器网关",
      description: "1,500+ 服务 · 11,000+ 动作",
      provider: "open-connector",
      installed: false,
    });
    expect(item).toMatchObject({
      key: "mcp:open-connector-gateway",
      kind: "mcp",
      serverId: "open-connector-gateway",
      gateway: true,
      name: "连接器网关",
      installed: false,
    });
  });

  it("passes the installed state through", () => {
    const item = buildGatewayMarketItem({
      name: "连接器网关",
      description: "",
      installed: true,
    });
    expect(item.installed).toBe(true);
  });
});
