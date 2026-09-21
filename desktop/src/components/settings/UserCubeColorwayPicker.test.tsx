import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_META_AVATAR_URL } from "../../constants/meta-avatar";
import { i18n } from "../../i18n/i18n";
import { BRAND_CUBE_COLORWAY_ID } from "../../utils/cube-colorway";
import { UserCubeColorwayPicker } from "./UserCubeColorwayPicker";

describe("UserCubeColorwayPicker", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh");
  });

  it("starts collapsed and names the costume row", () => {
    const html = renderToStaticMarkup(
      <UserCubeColorwayPicker selectedId={BRAND_CUBE_COLORWAY_ID} onSelect={() => {}} />,
    );
    expect(html).toContain("服装定制");
    expect(html).toContain("给 Near 换一套滑板配色");
    expect(html).toContain(DEFAULT_META_AVATAR_URL);
    expect(html).toContain("px-3 py-3");
    expect(html).toContain("rounded-md");
    expect(html).toContain("品牌橙");
    expect(html).not.toContain("随机一套");
    expect(html).not.toContain("type=\"file\"");
    expect(html).not.toContain("用户档案");
  });

  it("keeps the expanded costume tools inside the same row chrome", () => {
    const html = renderToStaticMarkup(
      <UserCubeColorwayPicker
        selectedId={BRAND_CUBE_COLORWAY_ID}
        onSelect={() => {}}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(html).toContain("随机一套");
    expect(html).toContain("抽卡提示词");
    expect(html).toContain("bg-surface-hover/30");
  });
});
