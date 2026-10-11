import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import { i18n } from "../../i18n/i18n";
import zh from "../../../locales/zh/marketplace.json";
import en from "../../../locales/en/marketplace.json";
import { NEW_CONNECTOR_MENU_ITEMS, NewConnectorButton } from "../settings/connectors/NewConnectorButton";
import { NEW_MCP_MENU_ITEMS, NewMcpButton } from "./NewMcpButton";

describe("新建连接器 menu", () => {
  it("only offers 从对话新建 / 从模板新建 (no custom MCP)", () => {
    expect([...NEW_CONNECTOR_MENU_ITEMS]).toEqual(["fromChat", "fromTemplate"]);
    for (const loc of [zh, en]) {
      const menu = loc.connectors.newMenu as Record<string, unknown>;
      expect(menu.customMcp).toBeUndefined();
      expect(menu.customMcpTitle).toBeUndefined();
      for (const item of NEW_CONNECTOR_MENU_ITEMS) expect(typeof menu[item]).toBe("string");
    }
  });

  it("renders the primary button", () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <NewConnectorButton connections={[]} onFromChat={() => {}} onChanged={() => {}} />
      </I18nextProvider>,
    );
    expect(html).toContain("data-new-connector-button");
    expect(html).not.toContain(i18n.t("mcpNew.button", { ns: "marketplace" }));
  });
});

describe("新建 MCP menu (plugin market MCP tab)", () => {
  it("offers remote URL and local stdio flows with zh/en copy", () => {
    expect([...NEW_MCP_MENU_ITEMS]).toEqual(["remote", "local"]);
    for (const loc of [zh, en]) {
      const m = (loc as unknown as { mcpNew: Record<string, string> }).mcpNew;
      expect(m.button).toBeTruthy();
      for (const item of NEW_MCP_MENU_ITEMS) {
        expect(m[item]).toBeTruthy();
        expect(m[`${item}Hint`]).toBeTruthy();
      }
    }
  });

  it("renders a primary 新建 MCP button", () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <NewMcpButton onChanged={() => {}} />
      </I18nextProvider>,
    );
    expect(html).toContain("data-new-mcp-button");
    expect(html).toContain("bg-btnPrimary");
    expect(html).toContain(i18n.t("mcpNew.button", { ns: "marketplace" }));
  });
});
