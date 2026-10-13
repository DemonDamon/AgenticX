import Markdown, { type MarkdownIt, type RenderRules } from "react-native-markdown-display";
import { Platform, StyleSheet } from "react-native";
import { brand, color, fontSize, radius, spacing } from "../ui/theme";
import { CodeBlock } from "./CodeBlock";

/** AI 回复 Markdown 主题：代码块暖色深底，链接/列表点用品牌橙 */
const mdStyles = StyleSheet.create({
  body: { color: color.textPrimary, fontSize: fontSize.bodyLg, lineHeight: 22 },
  strong: { color: color.textPrimary },
  em: { color: color.textPrimary },
  link: { color: brand.primary },
  heading1: {
    color: color.textPrimary,
    fontSize: fontSize.title,
    fontWeight: "700",
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  heading2: {
    color: color.textPrimary,
    fontSize: fontSize.bodyLg + 2,
    fontWeight: "700",
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  heading3: {
    color: color.textPrimary,
    fontSize: fontSize.bodyLg,
    fontWeight: "600",
    marginTop: spacing.sm,
    marginBottom: 2,
  },
  bullet_list_icon: { color: brand.primary },
  ordered_list_icon: { color: brand.primary },
  code_inline: {
    backgroundColor: brand.creamDeep,
    color: brand.primaryDark,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: fontSize.body - 1,
  },
  // fence 由自定义 renderRules 渲染成 CodeBlock（语言标签/着色/复制/展开），
  // 这里仅兜底未被规则命中的场景
  fence: {
    backgroundColor: "#2B2620",
    color: "#F5EFE6",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: fontSize.caption + 1,
    lineHeight: 18,
    borderRadius: radius.sm + 2,
    padding: spacing.sm + 2,
    borderWidth: 0,
    marginVertical: spacing.xs,
  },
  blockquote: {
    backgroundColor: brand.cream,
    borderLeftWidth: 3,
    borderLeftColor: brand.primaryLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginVertical: spacing.xs,
  },
  hr: { backgroundColor: color.border },
});

/** fence → CodeBlock：sourceInfo 是 ```语言 标识，content 是代码原文 */
const renderRules: RenderRules = {
  fence: (node) => (
    <CodeBlock
      key={node.key}
      code={(node.content ?? "").replace(/\n$/, "")}
      // ASTNode 类型未声明 sourceInfo，markdown-it 运行时一定带（```语言 标识）
      language={((node as { sourceInfo?: string }).sourceInfo ?? "").trim()}
    />
  ),
};

/** AI 回复 Markdown 渲染（用户气泡保持纯文本，勿用于 user role） */
export function AssistantMarkdown({ text }: { text: string }) {
  return <Markdown style={mdStyles} rules={renderRules}>{text}</Markdown>;
}
