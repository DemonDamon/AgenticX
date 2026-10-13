/**
 * 助手回复里的代码块：语言标签 + 轻量语法着色 + 复制 + 全屏展开。
 *
 * 替代 react-native-markdown-display 的默认 fence 渲染（纯文本无交互）。
 * 语法着色用单遍 tokenizer（关键字/字符串/注释/数字/函数名），零依赖、
 * 覆盖 Python/C/JS/Bash 等主流语言通用模式，不做逐语言完整高亮。
 */

// expo-clipboard 57.x 无默认导出，setStringAsync 为命名导出
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { memo, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { brand, color, fontSize, radius, spacing } from "../ui/theme";
import { commentStyleFor, tokenizeCode, type TokenKind } from "../lib/codeTokenize";

const TOKEN_COLOR: Record<TokenKind, string> = {
  plain: "#F5EFE6",
  keyword: "#FE9115",
  string: "#A8C97F",
  comment: "#8A8278",
  number: "#E8B04B",
  fn: "#7FB8D8",
};

const MONO = { fontFamily: "monospace" } as const;

const HighlightedCode = memo(function HighlightedCode({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const tokens = useMemo(
    () => tokenizeCode(code, commentStyleFor(language)),
    [code, language],
  );
  return (
    <Text style={styles.codeText}>
      {tokens.map((t, idx) => (
        <Text key={idx} style={{ color: TOKEN_COLOR[t.kind] }}>
          {t.text}
        </Text>
      ))}
    </Text>
  );
});

/* ---------- 组件 ---------- */

export function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const copy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const label = language || "text";

  return (
    <View style={styles.wrap}>
      {/* 顶栏：语言 + 操作 */}
      <View style={styles.bar}>
        <Text style={styles.lang}>{label}</Text>
        <View style={styles.barActions}>
          <Pressable hitSlop={8} onPress={copy} style={styles.iconBtn}>
            <Ionicons
              name={copied ? "checkmark" : "copy-outline"}
              size={15}
              color={copied ? brand.primary : color.textSecondary}
            />
            <Text style={[styles.iconLabel, copied && { color: brand.primary }]}>
              {copied ? "已复制" : "复制"}
            </Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={() => setExpanded(true)} style={styles.iconBtn}>
            <Ionicons name="expand-outline" size={15} color={color.textSecondary} />
            <Text style={styles.iconLabel}>展开</Text>
          </Pressable>
        </View>
      </View>
      {/* 代码体（横向滚动，长行不折断） */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <HighlightedCode code={code} language={label} />
      </ScrollView>

      {/* 全屏展开 */}
      <Modal visible={expanded} animationType="fade" onRequestClose={() => setExpanded(false)}>
        <StatusBar barStyle="light-content" />
        <View style={styles.sheetRoot}>
          <View style={styles.sheetBar}>
            <Text style={styles.sheetLang}>{label}</Text>
            <Pressable hitSlop={10} onPress={() => setExpanded(false)} style={styles.sheetClose}>
              <Ionicons name="close" size={22} color="#F5EFE6" />
            </Pressable>
          </View>
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <HighlightedCode code={code} language={label} />
            </ScrollView>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "#2B2620",
    borderRadius: radius.sm + 2,
    marginVertical: spacing.xs,
    overflow: "hidden",
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.sm + 2,
    paddingTop: spacing.xs + 2,
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#453D33",
  },
  lang: {
    color: "#B4ADA3",
    fontSize: fontSize.caption - 1,
    fontFamily: "monospace",
  },
  barActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4 },
  iconBtn: { flexDirection: "row", alignItems: "center", gap: 3 },
  iconLabel: { color: color.textSecondary, fontSize: fontSize.caption - 1 },
  codeText: {
    color: "#F5EFE6",
    fontFamily: "monospace",
    fontSize: fontSize.caption + 1,
    lineHeight: 19,
    padding: spacing.sm + 2,
    minWidth: "100%",
  },
  sheetRoot: {
    flex: 1,
    backgroundColor: "#211D18",
  },
  sheetBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: 52,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#453D33",
  },
  sheetLang: { color: "#F5EFE6", fontSize: fontSize.title, fontFamily: "monospace" },
  sheetClose: { padding: spacing.xs },
  sheetScroll: { flex: 1 },
  sheetContent: { padding: spacing.lg },
});
