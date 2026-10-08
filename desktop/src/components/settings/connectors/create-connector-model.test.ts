import { describe, expect, it } from "vitest";
import {
  applyCreateConnectorToMcpJson,
  buildCreateConnectorServerConfig,
  connectorTemplateSlug,
  filterConnectorTemplates,
  findExistingConnectorInstance,
  isConnectorNameTaken,
  listConnectorInstances,
  listConnectorTemplates,
  resolveConnectorConnectAction,
  sanitizeConnectorServerName,
  validateCreateConnectorForm,
} from "./create-connector-model";
import { authFormFields, CONNECTOR_SUPPLY, GATEWAY_SUPPLY_ID } from "./connector-supply";
import { mcpCredentialFingerprint } from "../../../utils/mcp-remote-config";

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
      _agenticx: { source: "connector", displayName: "zsxq" },
    });
    const b = buildCreateConnectorServerConfig("none", {
      name: "dingtalk",
      url: "http://127.0.0.1:9/mcp",
      apiKey: "",
      token: "",
    });
    expect(b.config).toEqual({
      url: "http://127.0.0.1:9/mcp",
      _agenticx: { source: "connector", displayName: "dingtalk" },
    });
  });

  it("uses template slug as server name and stamps templateId", () => {
    const c = buildCreateConnectorServerConfig(
      "custom_credential",
      { name: "轻流的连接器", url: "https://mcp.example/qf", apiKey: "", token: "t" },
      { templateId: "stub:qingflow" },
    );
    expect(c.serverName).toBe("qingflow");
    expect(c.config._agenticx).toEqual({
      source: "connector",
      templateId: "stub:qingflow",
      displayName: "轻流的连接器",
    });
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
      _agenticx: { source: "connector", displayName: "qingflow" },
    });

    // 同端点 + 同凭证：识别为已存在实例（不新增）
    const same = applyCreateConnectorToMcpJson(
      ok.text,
      "custom_credential",
      { name: "qingflow", url: "https://mcp.example/qf", apiKey: "", token: "tok" },
    );
    expect(same.ok).toBe(false);
    if (!same.ok) {
      expect(same.error).toBe("exists");
      expect(same.existing?.reason).toBe("same_endpoint");
    }

    // 同名不同端点：名称冲突
    const dup = applyCreateConnectorToMcpJson(
      ok.text,
      "custom_credential",
      { name: "qingflow", url: "https://other.example/qf", apiKey: "", token: "tok2" },
    );
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toBe("duplicate");
  });
});

const QF = { name: "轻流的连接器", url: "https://mcp.example/qf", apiKey: "", token: "tok-a" };

describe("template dedupe (no duplicate instances)", () => {
  const base = JSON.stringify({ mcpServers: { github: { command: "docker" } } });
  const first = applyCreateConnectorToMcpJson(base, "custom_credential", QF, { templateId: "stub:qingflow" });
  if (!first.ok) throw new Error("first create failed");

  it("creates one instance keyed by template slug", () => {
    expect(first.serverName).toBe("qingflow");
    expect(first.displayName).toBe("轻流的连接器");
    const instances = listConnectorInstances(JSON.parse(first.text));
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({ serverName: "qingflow", templateId: "stub:qingflow" });
  });

  it("returns exists for the same template instead of creating a second entry", () => {
    const again = applyCreateConnectorToMcpJson(
      first.text,
      "custom_credential",
      { ...QF, name: "轻流的连接器 2", token: "tok-b" },
      { templateId: "stub:qingflow" },
    );
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.error).toBe("exists");
      expect(again.existing?.reason).toBe("same_template");
      expect(again.existing?.instance.displayName).toBe("轻流的连接器");
    }
  });

  it("overwrite updates the existing instance credential in place", () => {
    const upd = applyCreateConnectorToMcpJson(
      first.text,
      "custom_credential",
      { ...QF, token: "tok-b" },
      { templateId: "stub:qingflow", overwrite: true },
    );
    expect(upd.ok).toBe(true);
    if (!upd.ok) return;
    expect(upd.existed).toBe(true);
    expect(upd.unchanged).toBe(false);
    const servers = JSON.parse(upd.text).mcpServers as Record<string, { headers?: Record<string, string> }>;
    expect(Object.keys(servers).sort()).toEqual(["github", "qingflow"]);
    expect(servers.qingflow?.headers?.Authorization).toBe("Bearer tok-b");
  });

  it("same credential + endpoint is reused without writing", () => {
    const reuse = applyCreateConnectorToMcpJson(first.text, "custom_credential", QF, {
      templateId: "stub:qingflow",
      overwrite: true,
    });
    expect(reuse.ok).toBe(true);
    if (!reuse.ok) return;
    expect(reuse.unchanged).toBe(true);
    expect(reuse.text).toBe(first.text);
  });

  it("rejects a different template reusing an existing display name", () => {
    const res = applyCreateConnectorToMcpJson(
      first.text,
      "custom_credential",
      { name: "轻流的连接器", url: "https://gitlab.example/mcp", apiKey: "", token: "g" },
      { templateId: "stub:gitlab" },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("duplicate");
  });

  it("never overwrites a non-connector entry occupying the template slug", () => {
    const occupied = JSON.stringify({ mcpServers: { gitlab: { command: "npx", args: ["gitlab-mcp"] } } });
    const res = applyCreateConnectorToMcpJson(
      occupied,
      "custom_credential",
      { name: "My GitLab", url: "https://gitlab.example/mcp", apiKey: "", token: "g" },
      { templateId: "stub:gitlab" },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.serverName).toBe("my-gitlab");
    const servers = JSON.parse(res.text).mcpServers as Record<string, unknown>;
    expect(servers.gitlab).toEqual({ command: "npx", args: ["gitlab-mcp"] });
  });
});

describe("findExistingConnectorInstance", () => {
  const fpA = mcpCredentialFingerprint({ Authorization: "Bearer a" });
  const fpB = mcpCredentialFingerprint({ Authorization: "Bearer b" });
  const instances = [
    { serverName: "qingflow", displayName: "轻流A", templateId: "stub:qingflow", url: "https://q/1", credentialFingerprint: fpA },
    { serverName: "qingflow-b", displayName: "轻流B", templateId: "stub:qingflow", url: "https://q/1", credentialFingerprint: fpB },
    { serverName: "gitlab", displayName: "gitlab", url: "https://g/mcp/", credentialFingerprint: "" },
  ];

  it("prefers same credential within the template", () => {
    expect(findExistingConnectorInstance(instances, { templateId: "stub:qingflow", credentialFingerprint: fpB }))
      .toMatchObject({ reason: "same_credential", instance: { serverName: "qingflow-b" } });
    expect(findExistingConnectorInstance(instances, { templateId: "stub:qingflow", credentialFingerprint: "fp-x" }))
      .toMatchObject({ reason: "same_template", instance: { serverName: "qingflow" } });
  });

  it("matches legacy untagged entry by template slug, and custom MCP by endpoint", () => {
    expect(findExistingConnectorInstance(instances, { templateId: "stub:gitlab" })).toMatchObject({
      reason: "same_server_name",
    });
    expect(findExistingConnectorInstance(instances, { url: "https://G/mcp" })).toMatchObject({
      reason: "same_endpoint",
      instance: { serverName: "gitlab" },
    });
    expect(findExistingConnectorInstance(instances, { templateId: "stub:linear" })).toBeNull();
  });

  it("name taken is case-insensitive and ignores self", () => {
    expect(isConnectorNameTaken(instances, "轻流a")).toBe(true);
    expect(isConnectorNameTaken(instances, "轻流A", "qingflow")).toBe(false);
    expect(isConnectorNameTaken(instances, "GitLab")).toBe(true);
  });
});

describe("credential fingerprint", () => {
  it("is stable, secret-free and empty without credentials", () => {
    const a = mcpCredentialFingerprint({ Authorization: "Bearer secret-token" });
    expect(a).toBe(mcpCredentialFingerprint({ authorization: "Bearer secret-token" }));
    expect(a).not.toContain("secret");
    expect(mcpCredentialFingerprint({ "Content-Type": "application/json" })).toBe("");
    expect(mcpCredentialFingerprint(undefined)).toBe("");
  });
});

describe("listConnectorTemplates", () => {
  it("excludes gateway, puts selectable first, marks oauth stubs unselectable", () => {
    const list = listConnectorTemplates(CONNECTOR_SUPPLY);
    expect(list.some((o) => o.entry.id === GATEWAY_SUPPLY_ID)).toBe(false);
    const firstUnselectable = list.findIndex((o) => !o.selectable);
    if (firstUnselectable >= 0) {
      expect(list.slice(firstUnselectable).every((o) => !o.selectable)).toBe(true);
    }
    expect(list.find((o) => o.entry.id === "stub:qingflow")).toMatchObject({
      action: "create_form",
      selectable: true,
    });
    expect(list.find((o) => o.entry.id === "stub:zoom")).toMatchObject({ selectable: false });
    expect(connectorTemplateSlug("stub:baidu-maps")).toBe("baidu-maps");
  });

  it("filters by name / description / id", () => {
    const items = [
      { id: "stub:qingflow", name: "轻流", description: "低代码流程" },
      { id: "stub:gitlab", name: "GitLab", description: "代码托管" },
    ];
    expect(filterConnectorTemplates(items, "git").map((i) => i.id)).toEqual(["stub:gitlab"]);
    expect(filterConnectorTemplates(items, "流程").map((i) => i.id)).toEqual(["stub:qingflow"]);
    expect(filterConnectorTemplates(items, " ")).toHaveLength(2);
  });
});
