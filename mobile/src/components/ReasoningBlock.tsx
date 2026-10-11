import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { brand, color, fontSize, fontWeight, radius, spacing } from "../ui/theme";

/** 「思考过程」折叠块：assistant 气泡上方，有 reasoning 才渲染 */
export function ReasoningBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.wrap}>
      <Pressable
        style={styles.toggle}
        onPress={() => {
          setOpen(!open);
        }}
      >
        <Text style={styles.toggleText}>{open ? "收起思考过程" : "思考过程"}</Text>
        <Text style={styles.chevron}>{open ? "⌄" : "›"}</Text>
      </Pressable>
      {open ? <Text style={styles.body}>{text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: brand.cream,
    borderRadius: radius.sm + 2,
    borderWidth: 1,
    borderColor: color.border,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    alignSelf: "stretch",
  },
  toggle: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  toggleText: {
    fontSize: fontSize.caption,
    color: brand.primaryDark,
    fontWeight: fontWeight.medium,
  },
  chevron: { fontSize: fontSize.caption, color: brand.primaryDark },
  body: {
    fontSize: fontSize.caption,
    color: color.textSecondary,
    lineHeight: 18,
    marginTop: spacing.xs,
    fontFamily: "Menlo",
  },
});
