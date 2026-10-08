import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONNECTOR_SUPPLY } from "./connector-supply";
import { buildNewConnectorChatDraft } from "./NewConnectorButton";
import { skillChipLabel } from "../../../utils/skill-chip-label";

type PyTemplate = {
  id: string;
  kind: string;
  auth: string;
  create_via: string;
  wired: boolean;
  mcp_url?: string;
  auth_query?: string;
  auth_header?: string;
  credential_label?: string;
  credential_placeholder?: string;
  credential_help_url?: string;
  credential_fields?: Array<{ name: string; label: string; placeholder?: string }>;
};

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

  it("mirrors wired / official mcp_url / auth_query for MCP templates", () => {
    const desktop = CONNECTOR_SUPPLY.filter((e) => e.kind === "mcp").map((e) => ({
      id: e.id,
      wired: e.wired,
      mcp_url: e.mcpUrl ?? null,
      auth_query: e.apiKeyQuery ?? null,
      auth_header: e.credentialHeader ?? null,
    }));
    expect(
      py
        .filter((t) => t.kind === "mcp")
        .map((t) => ({
          id: t.id,
          wired: t.wired,
          mcp_url: t.mcp_url ?? null,
          auth_query: t.auth_query ?? null,
          auth_header: t.auth_header ?? null,
        })),
    ).toEqual(desktop);
    for (const t of py) {
      if (t.auth === "mcp_oauth") expect(t.mcp_url && t.create_via === "mcp_url", t.id).toBeTruthy();
    }
  });

  it("mirrors credential label / placeholder / help URL", () => {
    const desktop = CONNECTOR_SUPPLY.filter((e) => e.kind !== "gateway").map((e) => ({
      id: e.id,
      label: e.credentialLabel ?? null,
      placeholder: e.credentialPlaceholder ?? null,
      help: e.credentialHelpUrl ?? null,
    }));
    expect(
      py.map((t) => ({
        id: t.id,
        label: t.credential_label ?? null,
        placeholder: t.credential_placeholder ?? null,
        help: t.credential_help_url ?? null,
      })),
    ).toEqual(desktop);
  });

  it("mirrors multi-field credential_fields (Comate dual-header)", () => {
    const desktop = CONNECTOR_SUPPLY.filter((e) => e.kind !== "gateway").map((e) => ({
      id: e.id,
      fields: (e.credentialFields ?? []).map((f) => ({
        name: f.name,
        label: f.label,
        placeholder: f.placeholder ?? null,
      })),
    }));
    expect(
      py.map((t) => ({
        id: t.id,
        fields: (t.credential_fields ?? []).map((f) => ({
          name: f.name,
          label: f.label,
          placeholder: f.placeholder ?? null,
        })),
      })),
    ).toEqual(desktop);
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
