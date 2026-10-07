import { describe, expect, it } from "vitest";
import {
  applyCreateConnectorToMcpJson,
  buildCreateConnectorServerConfig,
  resolveConnectorConnectAction,
  sanitizeConnectorServerName,
  validateCreateConnectorForm,
} from "./create-connector-model";
import { authFormFields } from "./connector-supply";

describe("resolveConnectorConnectAction", () => {
  it("routes gateway / wired native / form stubs / oauth stubs", () => {
    expect(resolveConnectorConnectAction({ gateway: true })).toBe("gateway");
    expect(
      resolveConnectorConnectAction({ wired: true, connectorId: "github", authType: "oauth2" }),
    ).toBe("handshake");
    expect(
      resolveConnectorConnectAction({ wired: false, authType: "custom_credential" }),
    ).toBe("create_form");
    expect(resolveConnectorConnectAction({ wired: false, authType: "api_key" })).toBe("create_form");
    expect(resolveConnectorConnectAction({ wired: false, authType: "none" })).toBe("create_form");
    expect(resolveConnectorConnectAction({ wired: false, authType: "oauth2" })).toBe("unwired_sheet");
  });
});

describe("authFormFields persistable shapes", () => {
  it("includes url for none/api_key/token forms", () => {
    expect(authFormFields("none")).toEqual(["name", "url"]);
    expect(authFormFields("api_key")).toEqual(["name", "url", "api_key"]);
    expect(authFormFields("custom_credential")).toEqual(["name", "url", "token"]);
  });
});

describe("sanitizeConnectorServerName", () => {
  it("normalizes display names", () => {
    expect(sanitizeConnectorServerName("轻流 Prod")).toBe("prod");
    expect(sanitizeConnectorServerName("轻流")).toMatch(/^connector-/);
    expect(sanitizeConnectorServerName("My GitLab")).toBe("my-gitlab");
    expect(sanitizeConnectorServerName("  DingTalk  ")).toBe("dingtalk");
  });
});

describe("validateCreateConnectorForm", () => {
  it("requires credential fields by auth", () => {
    expect(validateCreateConnectorForm("none", { name: "x", url: "", apiKey: "", token: "" }).url).toBe(
      "required_url",
    );
    expect(
      validateCreateConnectorForm("api_key", {
        name: "tyc",
        url: "https://mcp.example/tyc",
        apiKey: "",
        token: "",
      }).apiKey,
    ).toBe("required_api_key");
    expect(
      validateCreateConnectorForm("custom_credential", {
        name: "qingflow",
        url: "https://mcp.example/qf",
        apiKey: "",
        token: "",
      }).token,
    ).toBe("required_token");
  });
});

describe("buildCreateConnectorServerConfig", () => {
  it("writes bearer from api_key or token", () => {
    const a = buildCreateConnectorServerConfig("api_key", {
      name: "zsxq",
      url: "https://example.com/mcp",
      apiKey: "k1",
      token: "",
    });
    expect(a.serverName).toBe("zsxq");
    expect(a.config).toEqual({
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer k1" },
    });
    const b = buildCreateConnectorServerConfig("none", {
      name: "dingtalk",
      url: "http://127.0.0.1:9/mcp",
      apiKey: "",
      token: "",
    });
    expect(b.config).toEqual({ url: "http://127.0.0.1:9/mcp" });
  });
});

describe("applyCreateConnectorToMcpJson", () => {
  it("merges a new server and rejects duplicates", () => {
    const base = JSON.stringify({ mcpServers: { github: { command: "docker" } } }, null, 2);
    const ok = applyCreateConnectorToMcpJson(
      base,
      "custom_credential",
      { name: "qingflow", url: "https://mcp.example/qf", apiKey: "", token: "tok" },
    );
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.serverName).toBe("qingflow");
    expect(ok.existed).toBe(false);
    const parsed = JSON.parse(ok.text) as { mcpServers: Record<string, unknown> };
    expect(parsed.mcpServers.github).toEqual({ command: "docker" });
    expect(parsed.mcpServers.qingflow).toEqual({
      url: "https://mcp.example/qf",
      headers: { Authorization: "Bearer tok" },
    });

    const dup = applyCreateConnectorToMcpJson(
      ok.text,
      "custom_credential",
      { name: "qingflow", url: "https://mcp.example/qf", apiKey: "", token: "tok" },
    );
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toBe("duplicate");
  });
});
