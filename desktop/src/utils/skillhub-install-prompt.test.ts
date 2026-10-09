import { describe, expect, it } from "vitest";
import {
  assertSafeSkillHubAgentInstallPrompt,
  buildSkillHubAgentInstallPrompt,
  SKILLHUB_AGENT_PROMPT_FORBIDDEN,
} from "./skillhub-install-prompt";

describe("buildSkillHubAgentInstallPrompt", () => {
  it("builds shortest-path prompt without old Studio registry install", () => {
    const prompt = buildSkillHubAgentInstallPrompt("archify");
    expect(prompt).toContain("archify");
    expect(prompt).toContain("skills_store_cli.py --skip-self-upgrade install archify");
    expect(prompt).toContain("skill_manage create");
    expect(prompt).toContain("source=skillhub");
    expect(prompt).toContain("action=view");
    expect(prompt).toContain("/api/registry/skillhub/install");
    expect(prompt).toContain("禁止先检查或部署 SkillHub store");
    for (const needle of SKILLHUB_AGENT_PROMPT_FORBIDDEN) {
      if (needle === "/api/registry/install" || needle === "POST /api/registry/install") {
        const stripped = prompt.replace(/\/api\/registry\/skillhub\/install/g, "");
        expect(stripped).not.toContain(needle);
      } else {
        expect(prompt).not.toContain(needle);
      }
    }
  });

  it("returns empty for blank slug", () => {
    expect(buildSkillHubAgentInstallPrompt("  ")).toBe("");
  });
});

describe("assertSafeSkillHubAgentInstallPrompt", () => {
  it("rejects old Meta Settings prompt that demands POST /api/registry/install", () => {
    const old = [
      "请安装 SkillHub 第三方技能「archify」。",
      "1. 优先调用本机 Studio API：POST /api/registry/install，body 含 source 与 name。",
      "请先检查是否已安装 SkillHub 商店；若未安装，请根据 https://skillhub-xxx 安装 SkillHub 商店",
    ].join("\n");
    expect(() => assertSafeSkillHubAgentInstallPrompt(old)).toThrow(
      /forbidden instruction/,
    );
  });

  it("rejects bare /api/registry/install but allows skillhub install route", () => {
    expect(() =>
      assertSafeSkillHubAgentInstallPrompt("curl http://127.0.0.1:3000/api/registry/install"),
    ).toThrow(/forbidden instruction/);
    expect(() =>
      assertSafeSkillHubAgentInstallPrompt(
        "use Desktop IPC POST /api/registry/skillhub/install",
      ),
    ).not.toThrow();
  });
});
