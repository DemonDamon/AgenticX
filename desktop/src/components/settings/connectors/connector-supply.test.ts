import { describe, expect, it } from "vitest";
import {
  CONNECTOR_SUPPLY,
  authFormFields,
  listCatalogSupply,
  listUnwiredSupply,
  listWiredSupply,
} from "./connector-supply";

describe("connector-supply", () => {
  it("marks only native CLI-backed ids as wired, plus the gateway entry", () => {
    const wired = listWiredSupply();
    expect(wired.some((e) => e.kind === "gateway")).toBe(true);
    const wiredNatives = wired.filter((e) => e.kind === "native").map((e) => e.connectorId);
    expect(wiredNatives.sort()).toEqual(
      ["feishu", "github", "qqmail", "tapd", "tencent-meeting", "wecom"].sort(),
    );
  });

  it("keeps Slack/Discord-class stubs unwired (no fake connected)", () => {
    const unwired = listUnwiredSupply();
    const ids = unwired.map((e) => e.connectorId).filter(Boolean);
    expect(ids).toContain("slack");
    expect(ids).toContain("gmail");
    expect(ids).not.toContain("wecom");
    // 已核实官方端点的模板（高德 / 腾讯文档 / Notion 等）已接线，不再算未接线。
    expect(unwired.some((e) => e.id === "stub:amap")).toBe(false);
    expect(unwired.some((e) => e.id === "stub:tencent-docs")).toBe(false);
    expect(unwired.some((e) => e.id === "native:notion")).toBe(false);
    expect(unwired.some((e) => e.id === "stub:wps")).toBe(true);
    expect(unwired.some((e) => e.id === "stub:dingtalk")).toBe(true);
    expect(unwired.some((e) => e.id === "stub:gildata")).toBe(false);
    expect(unwired.some((e) => e.id === "stub:pkulaw")).toBe(false);
    expect(unwired.some((e) => e.id === "stub:esign")).toBe(true);
    expect(unwired.some((e) => e.id === "stub:neocrm")).toBe(false);
    expect(unwired.some((e) => e.id === "stub:legal")).toBe(false);
  });

  it("includes Comate financial/legal MCP stubs with form auth", () => {
    const gildata = CONNECTOR_SUPPLY.find((e) => e.id === "stub:gildata");
    const outlook = CONNECTOR_SUPPLY.find((e) => e.id === "stub:outlook");
    const wps = CONNECTOR_SUPPLY.find((e) => e.id === "stub:wps");
    expect(gildata?.auth).toBe("api_key");
    expect(gildata?.apiKeyQuery).toBe("token");
    expect(gildata?.iconSrc).toBeTruthy();
    // 恒生聚源：官方 Streamable HTTP 端点 + Comate 同款凭证文案 / 帮助链接
    expect(gildata?.wired).toBe(true);
    expect(gildata?.mcpUrl).toBe("https://api.gildata.com/mcp-servers/aidata-assistant-srv-tool");
    expect(gildata?.credentialLabel).toBe("Access Token");
    expect(gildata?.credentialPlaceholder).toBe("请填写恒生聚源下发的Access Token");
    expect(gildata?.credentialHelpUrl).toBe("https://vcn7e7nesi3s.feishu.cn/docx/MeCmd4q0Yo7nmkx9D8IcMYbknob");
    expect(outlook?.fallbackName).toBe("Outlook");
    expect(wps?.fallbackName).toBe("WPS Office");
  });

  it("exposes auth types for handshake routing (Comate-style forms)", () => {
    const wecom = CONNECTOR_SUPPLY.find((e) => e.connectorId === "wecom");
    const tapd = CONNECTOR_SUPPLY.find((e) => e.connectorId === "tapd");
    const dingtalk = CONNECTOR_SUPPLY.find((e) => e.id === "stub:dingtalk");
    const qingflow = CONNECTOR_SUPPLY.find((e) => e.id === "stub:qingflow");
    const zsxq = CONNECTOR_SUPPLY.find((e) => e.id === "stub:zsxq");
    expect(wecom?.auth).toBe("none");
    expect(tapd?.auth).toBe("api_key");
    expect(dingtalk?.auth).toBe("none");
    expect(dingtalk?.authFormHint).toBe("name_only");
    expect(qingflow?.auth).toBe("custom_credential");
    expect(qingflow?.authFormHint).toBe("token");
    expect(zsxq?.auth).toBe("api_key");
    expect(zsxq?.authFormHint).toBe("api_key");
  });

  it("maps auth to create-form fields", () => {
    // stubs persist as custom MCP → url required; none has no secret (name_only + url)
    expect(authFormFields("none")).toEqual(["name", "url"]);
    expect(authFormFields("api_key")).toEqual(["name", "url", "api_key"]);
    expect(authFormFields("custom_credential")).toEqual(["name", "url", "token"]);
    expect(authFormFields("oauth2")).toEqual(["name"]);
  });

  it("catalog always includes wired and unwired; gateway has icon", () => {
    const all = listCatalogSupply();
    expect(all.length).toBeGreaterThan(listWiredSupply().length);
    const gw = all.find((e) => e.kind === "gateway");
    expect(gw?.iconSrc).toBeTruthy();
  });
});
