import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONNECTOR_SUPPLY } from "./connector-supply";
import { buildNewConnectorChatDraft } from "./NewConnectorButton";
import { skillChipLabel } from "../../../utils/skill-chip-label";

type PyTemplate = { id: string; kind: string; auth: string; create_via: string };

/** Python `connector_manage` catalog must mirror the desktop supply (ids / kind / auth). */
describe("connector templates parity (desktop ↔ agenticx/runtime/connector_templates.json)", () => {
  const raw = readFileSync(resolve(__dirname, "../../../../../agenticx/runtime/connector_templates.json"), "utf-8");
  const py = (JSON.parse(raw) as { templates: PyTemplate[] }).templates;

  it("lists the same non-gateway templates with the same auth", () => {
    const desktop = CONNECTOR_SUPPLY.filter((e) => e.kind !== "gateway").map((e) => ({
      id: e.id,
      kind: e.kind,
      auth: e.auth,
    }));
    expect(py.map(({ id, kind, auth }) => ({ id, kind, auth }))).toEqual(desktop);
  });

  it("only lets chat create MCP-url templates that the create form supports", () => {
    for (const t of py) {
      if (t.create_via === "mcp_url") expect(t.kind === "mcp" && t.auth !== "oauth2").toBe(true);
    }
  });
});

describe("从对话新建 draft", () => {
  it("prefixes the connector-assistant skill chip", () => {
    expect(buildNewConnectorChatDraft("请帮我创建一个连接器")).toBe(
      "@skill://connector-assistant 请帮我创建一个连接器",
    );
    expect(skillChipLabel("connector-assistant", "zh-CN")).toBe("连接器助手");
    expect(skillChipLabel("connector-assistant", "en")).toBe("Connector Assistant");
    expect(skillChipLabel("other-skill", "zh")).toBe("other-skill");
  });
});
