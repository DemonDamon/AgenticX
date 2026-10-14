/**
 * 底部选择面板（对标 Trae 手机端）。
 *
 * - 图1「当前活跃项目」：圆点/勾选 + 名称 + 灰色完整路径
 * - 图2「选择任务运行位置」：单选圈 + 设备图标 + 名称 + 平台 chip + 右侧在线/离线
 * - 图3：列表末尾「云端」行 + 虚线框「+ 连接你的电脑」
 *
 * 三处共用同一套壳与行原语，保证形态一致。
 */

import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { brand, color, fontSize, fontWeight, radius, spacing } from "../ui/theme";

type IoniconName = keyof typeof Ionicons.glyphMap;

/* ---------- 壳 ---------- */

export interface PickerSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** 图1 形态：左上角返回箭头 */
  onBack?: () => void;
  /** 列表下方的提示文案（图1 底部灰字） */
  footer?: ReactNode;
  children: ReactNode;
}

export function PickerSheet({
  visible,
  onClose,
  title,
  onBack,
  footer,
  children,
}: PickerSheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            {onBack !== undefined ? (
              <Pressable onPress={onBack} hitSlop={8} style={styles.headerSide}>
                <Ionicons name="chevron-back" size={22} color={color.textPrimary} />
              </Pressable>
            ) : (
              <View style={styles.headerSide} />
            )}
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8} style={styles.headerSide}>
              <Ionicons name="close" size={22} color={color.textPrimary} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            {children}
            {footer !== undefined ? <View style={styles.footer}>{footer}</View> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* ---------- 行原语 ---------- */

export interface OptionRowProps {
  label: string;
  /** 名称下方的灰色一行（项目路径 / 设备 chip 由 icon 侧承载时留空） */
  sublabel?: string;
  selected: boolean;
  onPress: () => void;
  /** 选中态标记：勾选（图1）或单选圈（图2） */
  variant?: "check" | "radio";
  /** 标记与名称之间的图标（设备行） */
  icon?: IoniconName;
  /** 名称下方的自定义节点（平台 chip） */
  badge?: ReactNode;
  /** 右侧状态节点（在线/离线） */
  right?: ReactNode;
  /** 选中项的黑色描边（图2） */
  outlined?: boolean;
}

export function OptionRow({
  label,
  sublabel,
  selected,
  onPress,
  variant = "check",
  icon,
  badge,
  right,
  outlined = false,
}: OptionRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        outlined && styles.rowOutlined,
        pressed && styles.rowPressed,
      ]}
    >
      <View style={styles.marker}>
        {variant === "check" ? (
          selected ? (
            <Ionicons name="checkmark" size={20} color={color.textPrimary} />
          ) : (
            <View style={styles.circle} />
          )
        ) : (
          <View style={[styles.circle, selected && styles.circleSelected]}>
            {selected ? <View style={styles.radioDot} /> : null}
          </View>
        )}
      </View>
      {icon !== undefined ? (
        <View style={styles.rowIcon}>
          <Ionicons name={icon} size={22} color={color.textPrimary} />
        </View>
      ) : null}
      <View style={styles.rowMain}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {label}
        </Text>
        {badge !== undefined ? <View style={styles.rowBadge}>{badge}</View> : null}
        {sublabel !== undefined ? (
          <Text style={styles.rowSub} numberOfLines={1}>
            {sublabel}
          </Text>
        ) : null}
      </View>
      {right !== undefined ? <View style={styles.rowRight}>{right}</View> : null}
    </Pressable>
  );
}

/** 平台/标识 chip（图2 的 TRAE 绿底、TraeWork 紫底） */
export function Chip({ label, tone = "brand" }: { label: string; tone?: "brand" | "accent" }) {
  return (
    <View style={[styles.chip, tone === "accent" && styles.chipAccent]}>
      <Text style={[styles.chipText, tone === "accent" && styles.chipTextAccent]}>{label}</Text>
    </View>
  );
}

/** 设备在线/离线状态（图2 右侧 ●在线 / ●离线） */
export function StatePill({ online }: { online: boolean }) {
  return (
    <View style={styles.statePill}>
      <View style={[styles.stateDot, { backgroundColor: online ? color.online : color.offline }]} />
      <Text style={styles.stateText}>{online ? "在线" : "离线"}</Text>
    </View>
  );
}

/** 虚线框动作（图3「+ 连接你的电脑」） */
export function SheetAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
    >
      <Ionicons name="add" size={20} color={color.textPrimary} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

/** 面板内空态 / 错误提示 */
export function SheetNote({ text, tone = "muted" }: { text: string; tone?: "muted" | "danger" }) {
  return (
    <Text style={[styles.note, tone === "danger" && styles.noteDanger]}>{text}</Text>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(20, 16, 12, 0.38)",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "84%",
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.borderStrong,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerSide: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: {
    flex: 1,
    textAlign: "center",
    fontSize: fontSize.title,
    fontWeight: fontWeight.semibold,
    color: color.textPrimary,
  },
  body: { flexGrow: 0 },
  bodyContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  footer: { paddingVertical: spacing.md, paddingHorizontal: spacing.xs },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "transparent",
    gap: spacing.sm,
  },
  rowOutlined: { borderColor: color.textPrimary, borderWidth: 1.5 },
  rowPressed: { backgroundColor: color.bg },
  // 图1 勾选标记比图2 单选圈窄一些，统一宽度保证名称左对齐
  marker: { width: 26, alignItems: "center", justifyContent: "center" },
  circle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: color.borderStrong,
  },
  circleSelected: { borderColor: color.textPrimary, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.textPrimary },
  rowIcon: { width: 26, alignItems: "center", justifyContent: "center" },
  rowMain: { flex: 1, gap: 2 },
  rowLabel: { fontSize: fontSize.bodyLg + 1, color: color.textPrimary },
  rowBadge: { flexDirection: "row" },
  rowSub: { fontSize: fontSize.body, color: color.textMuted },
  rowRight: { paddingLeft: spacing.sm },

  chip: {
    alignSelf: "flex-start",
    backgroundColor: "#DDF3E4",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chipAccent: { backgroundColor: "#E4E4FB" },
  chipText: { fontSize: fontSize.caption - 1, color: "#2E7D4F", fontWeight: fontWeight.medium },
  chipTextAccent: { color: "#5B5BC4" },

  statePill: { flexDirection: "row", alignItems: "center", gap: 5 },
  stateDot: { width: 7, height: 7, borderRadius: 4 },
  stateText: { fontSize: fontSize.body, color: color.textSecondary },

  action: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: color.borderStrong,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
  },
  actionPressed: { backgroundColor: color.bg },
  actionText: { fontSize: fontSize.bodyLg, color: color.textPrimary, fontWeight: fontWeight.medium },

  note: {
    fontSize: fontSize.body,
    color: color.textMuted,
    lineHeight: 20,
  },
  noteDanger: { color: color.danger },
});
