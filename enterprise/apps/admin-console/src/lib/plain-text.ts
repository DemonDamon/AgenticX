/**
 * 把一段 Markdown 说明压成一行纯文本，供卡片、列表这类只给两行的地方显示。
 *
 * SkillHub 上的说明是按 Markdown 写的——反引号包命令、方括号带链接。整段塞进卡片就是
 * 一串 `gh issue`、`gh pr` 的反引号，读起来像没渲染完的页面。这里不渲染成富文本：
 * 卡片只有两行，加粗和代码块在这个尺寸下帮不上忙，把标记去掉就够了。
 *
 * 下划线强调（`_x_`）不处理。它和 `web_search`、`mcp_server_fetch` 这类标识符长得一样，
 * 分不清就会把名字本身拆坏——漏掉一个真正的强调只是少了点样式，改坏一个名字是错的。
 */
export function plainText(markdown: string | null | undefined): string {
  if (!markdown) return "";
  return markdown
    .replace(/```[\s\S]*?```/g, " ")           // 围栏代码块整段丢掉，两行里放不下
    .replace(/`([^`]*)`/g, "$1")               // 行内代码只去反引号，命令本身要留
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")  // 图片留 alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")   // 链接留文字，地址在详情页上有
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")        // 标题标记
    .replace(/^\s{0,3}>\s?/gm, "")             // 引用标记
    .replace(/^\s{0,3}([-*+]|\d+\.)\s+/gm, "") // 列表符号
    .replace(/\s+/g, " ")                      // 折行压成一行，clamp 才数得准
    .trim();
}
