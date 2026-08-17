import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  getSkillHubDetailUrl,
  SkillHubMarketplace,
  SkillMarketCard,
} from "./SkillHubMarketplace";

describe("SkillHubMarketplace", () => {
  it("renders browse categories before the remote catalogue resolves", () => {
    const html = renderToStaticMarkup(
      <SkillHubMarketplace getInstallState={() => "idle"} onInstall={() => undefined} />,
    );

    expect(html).toContain("SkillHub 技能目录");
    expect(html).toContain("金融");
    expect(html).toContain("文档 / PDF");
    expect(html).toContain("表格 / 数据");
    expect(html).toContain("演示 / 办公");
    expect(html).toContain("搜索名称、用途或发布者");
    expect(html).toContain('aria-label="搜索技能"');
    expect(html).toContain('aria-busy="true"');
  });

  it("keeps installation feedback next to the catalogue", () => {
    const html = renderToStaticMarkup(
      <SkillHubMarketplace
        installStatusMessage="正在获取并检查技能…"
        installStatusTone="neutral"
        getInstallState={() => "idle"}
        onInstall={() => undefined}
      />,
    );

    expect(html).toContain("正在获取并检查技能…");
    expect(html).toContain('aria-live="polite"');
  });

  it("accepts card-scoped installation feedback", () => {
    const html = renderToStaticMarkup(
      <SkillMarketCard
        item={{
          slug: "native-skill",
          name: "原生技能",
          description: "说明",
          version: "latest",
          author: "发布者",
          source: "skillhub",
          source_type: "skillhub",
          origin_source: "skillhub_api",
          provenance_source: "skillhub",
        }}
        installState="pending"
        installMessage="此技能需要确认权限"
        onInstall={() => undefined}
      />,
    );

    expect(html).toContain("此技能需要确认权限");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("详情");
    expect(html).toContain("待确认");
  });

  it("hides the native detail action for compatibility results", () => {
    const html = renderToStaticMarkup(
      <SkillMarketCard
        item={{
          slug: "compat-skill",
          name: "兼容来源技能",
          description: "说明",
          version: "latest",
          author: "发布者",
          source: "mirror",
          source_type: "clawhub",
          origin_source: "clawhub_registry",
          origin_hint: "当前结果来自兼容镜像。",
          provenance_source: "skillhub",
        }}
        installState="idle"
        onInstall={() => undefined}
      />,
    );

    expect(html).toContain("当前结果来自兼容镜像。");
    expect(html).not.toContain("详情");
  });

  it("uses the verified bare-slug route only for native results", () => {
    const base = {
      slug: "report-reader",
      name: "Report Reader",
      description: "",
      version: "latest",
      author: "unknown",
      source: "skillhub",
      source_type: "skillhub",
      namespace: "publisher",
      provenance_source: "skillhub" as const,
    };

    expect(getSkillHubDetailUrl({ ...base, origin_source: "skillhub_api" })).toBe(
      "https://skillhub.cn/skills/report-reader",
    );
    expect(getSkillHubDetailUrl({ ...base, origin_source: "clawhub_registry" })).toBeNull();
    expect(getSkillHubDetailUrl({ ...base, origin_source: "skillhub_cli" })).toBeNull();
  });
});
