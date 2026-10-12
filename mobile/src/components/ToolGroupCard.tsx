import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ToolStep } from "../lib/messages";
import { brand, color, fontSize, fontWeight, radius, shadow, spacing } from "../ui/theme";

/** 工具调用分组折叠卡（方案 1 完成态）：收起「执行 N 个步骤 ›」，展开逐条明细 */
export function ToolGroupCard({ steps }: { steps: ToolStep[] }) {
  const [open, setOpen] = useState(false);
  const errCount = steps.filter((s) => s.status === "error").length;

  return (
    <View style={styles.wrap}>
      <Pressable
        style={styles.header}
        onPress={() => {
          setOpen(!open);
        }}
      >
        <Text style={styles.headerText}>执行 {steps.length} 个步骤</Text>
        {errCount > 0 ? <Text style={styles.errBadge}>{errCount} 失败</Text> : null}
        <Text style={styles.chevron}>{open ? "⌄" : "›"}</Text>
      </Pressable>
      {open ? (
        <View style={styles.body}>
          {steps.map((s, i) => (
            <View key={`${i}-${s.toolName}`} style={styles.step}>
              <Text
                style={[styles.statusIcon, s.status === "error" ? styles.statusError : null]}
              >
                {s.status === "error" ? "✕" : "✓"}
              </Text>
              <View style={styles.stepBody}>
                <Text style={styles.toolName}>{s.toolName}</Text>
                {s.detail !== "" ? (
                  <Text style={styles.detail} numberOfLines={6}>
                    {s.detail}
                  </Text>
                ) : null}
                {s.resultPreview !== "" ? (
                  <Text style={styles.preview} numberOfLines={2}>
                    {s.resultPreview}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: color.card,
    borderRadius: radius.md + 2,
    borderWidth: 1,
    borderColor: color.border,
    alignSelf: "stretch",
    marginVertical: spacing.xs,
    ...shadow.card,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  headerText: {
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
    color: color.textPrimary,
    flexShrink: 1,
  },
  errBadge: {
    fontSize: fontSize.caption,
    color: color.danger,
    backgroundColor: color.dangerBg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 1,
    overflow: "hidden",
  },
  chevron: { fontSize: fontSize.body, color: brand.primary, marginLeft: "auto" },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
    padding: spacing.md,
    gap: spacing.sm + 2,
  },
  step: { flexDirection: "row", gap: spacing.sm },
  statusIcon: { fontSize: fontSize.body, color: color.online, marginTop: 1 },
  statusError: { color: color.danger },
  stepBody: { flexShrink: 1, flex: 1, gap: 2 },
  toolName: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    color: brand.primaryDark,
  },
  detail: {
    fontSize: fontSize.caption,
    color: color.textPrimary,
    fontFamily: "Menlo",
    backgroundColor: brand.cream,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: spacing.xs,
  },
  preview: { fontSize: fontSize.caption, color: color.textMuted, lineHeight: 16 },
});
