import { describe, expect, it } from "vitest";
import {
  assertSafeSkillHubAgentInstallPrompt,
  buildSkillHubAgentInstallPrompt,
  classifySkillHubInboundInstallPrompt,
  extractSkillHubInstallSlugFromPrompt,
  isForbiddenSkillHubAgentInstallPrompt,
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

describe("inbound intercept of old SkillHub install copy", () => {
  const oldCopy = [
    "请安装 SkillHub 第三方技能「archify」。",
    "1. 优先调用本机 Studio API：POST /api/registry/install，body 含 source 与 name。",
    "2. 若 API 不可用，可将 SKILL.md 安装到 ~/.agenticx/skills/registry/archify/",
    "请先检查是否已安装 SkillHub 商店；若未安装，请根据 https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/skillhub.md 安装 SkillHub 商店",
  ].join("\n");

  it("flags old Meta install prompt as forbidden", () => {
    expect(isForbiddenSkillHubAgentInstallPrompt(oldCopy)).toBe(true);
  });

  it("does not flag the new agent fallback prompt", () => {
    const prompt = buildSkillHubAgentInstallPrompt("archify");
    expect(isForbiddenSkillHubAgentInstallPrompt(prompt)).toBe(false);
  });

  it("extracts slug from old copy", () => {
    expect(extractSkillHubInstallSlugFromPrompt(oldCopy)).toBe("archify");
  });

  it("classify hits and returns slug so callers can force installFromSkillHub", () => {
    const hit = classifySkillHubInboundInstallPrompt(oldCopy);
    expect(hit.hit).toBe(true);
    if (hit.hit) {
      expect(hit.slug).toBe("archify");
      expect(hit.reason).toMatch(/拦截|Desktop|install/i);
    }
  });

  it("classify misses ordinary chat", () => {
    expect(classifySkillHubInboundInstallPrompt("帮我写个 hello world").hit).toBe(false);
  });
});
