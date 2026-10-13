import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  aggregateProcessSteps,
  fmtDurationMs,
  processGroupLabel,
  processGroupTitle,
  type ProcessGroup,
  type ProcessStep,
  type ToolCategory,
  type ToolStep,
} from "../lib/messages";
import { brand, color, fontSize, fontWeight, radius, shadow, spacing } from "../ui/theme";

/** 类目 → 详情抽屉时间线图标 */
const CATEGORY_ICON: Record<ToolCategory, keyof typeof Ionicons.glyphMap> = {
  cmd: "terminal-outline",
  read: "document-text-outline",
  write: "create-outline",
  search: "search-outline",
  web: "globe-outline",
  tool: "construct-outline",
};

function groupIcon(g: ProcessGroup): keyof typeof Ionicons.glyphMap {
  if (g.kind === "thinking") return "bulb-outline";
  return CATEGORY_ICON[g.category];
}

function groupHasError(g: ProcessGroup): boolean {
  return g.steps.some((s) => s.kind === "tool" && s.tool.status === "error");
}

/** 工具步的详情主行：命令类取命令原文，其它优先作用目标再退参数摘要 */
function toolHeadline(s: ToolStep, category: ToolCategory): string {
  if (category === "cmd") return s.detail !== "" ? s.detail : s.toolName;
  if (s.target !== "") return s.target;
  return s.detail !== "" ? s.detail : s.toolName;
}

/** 详情抽屉里的单个工具步 */
function SheetToolStep({ step, category }: { step: ToolStep; category: ToolCategory }) {
  const failed = step.status === "error";
  return (
    <View style={styles.sheetToolItem}>
      <View style={styles.sheetToolHeadRow}>
        <Ionicons
          name={failed ? "close-circle" : "checkmark-circle"}
          size={14}
          color={failed ? color.danger : color.online}
        />
        <Text
          style={[styles.sheetToolHead, failed ? styles.sheetToolHeadErr : null]}
          numberOfLines={2}
        >
          {toolHeadline(step, category)}
        </Text>
        {step.elapsedSec !== null ? (
          <Text style={styles.sheetElapsed}>{fmtDurationMs(step.elapsedSec * 1000)}</Text>
        ) : null}
      </View>
      {step.resultPreview !== "" ? (
        <Text style={styles.sheetPreview} numberOfLines={3}>
          {step.resultPreview}
        </Text>
      ) : null}
    </View>
  );
}

/** 详情抽屉里的一个时间线组（图标 + 竖线 + 内容） */
function SheetGroup({ group, isLast }: { group: ProcessGroup; isLast: boolean }) {
  const hasErr = groupHasError(group);
  return (
    <View style={styles.sheetGroup}>
      <View style={styles.sheetRail}>
        <View style={[styles.sheetIconCircle, hasErr ? styles.sheetIconCircleErr : null]}>
          <Ionicons
            name={groupIcon(group)}
            size={15}
            color={hasErr ? color.danger : brand.primaryDark}
          />
        </View>
        {!isLast ? <View style={styles.sheetRailLine} /> : null}
      </View>
      <View style={styles.sheetGroupBody}>
        <Text style={styles.sheetGroupTitle}>{processGroupTitle(group)}</Text>
        {group.steps.map((s, i) =>
          s.kind === "thinking" ? (
            <Text key={i} style={styles.sheetThinking}>
              {s.text}
            </Text>
          ) : (
            <SheetToolStep key={i} step={s.tool} category={group.category} />
          ),
        )}
      </View>
    </View>
  );
}

/**
 * 回合任务过程卡（Trae 式三段交互）：
 * 1. 完成态默认折叠为「任务耗时 X」分隔条；进行中显示「任务进行中…」并默认展开
 * 2. 展开是灰字步进行（思考过程 › / 执行 N 条命令 ›），相邻同类聚合
 * 3. 点任意步进行，从底部滑出「详情」抽屉：时间线 + 逐条命令/文件/思考明细
 */
export function TurnProcessCard({
  steps,
  durationMs,
  running,
}: {
  steps: ProcessStep[];
  durationMs: number | null;
  running: boolean;
}) {
  const [open, setOpen] = useState(running);
  const [sheetVisible, setSheetVisible] = useState(false);
  const insets = useSafeAreaInsets();

  // 回合完成瞬间自动折叠回耗时条（Trae 观感：跑完即收起，只留交付与耗时）
  useEffect(() => {
    if (!running) setOpen(false);
  }, [running]);

  const groups = useMemo(() => aggregateProcessSteps(steps), [steps]);
  const errCount = steps.filter((s) => s.kind === "tool" && s.tool.status === "error").length;
  const headerLabel = running
    ? "任务进行中…"
    : durationMs !== null
      ? `任务耗时 ${fmtDurationMs(durationMs)}`
      : "任务过程";

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <View style={styles.headerLine} />
        <Pressable
          style={({ pressed }) => [styles.headerBtn, pressed && styles.headerBtnPressed]}
          onPress={() => {
            setOpen(!open);
          }}
          hitSlop={6}
        >
          {running ? (
            <ActivityIndicator size={12} color={brand.primary} />
          ) : (
            <Ionicons name="time-outline" size={13} color={color.textMuted} />
          )}
          <Text style={styles.headerLabel}>{headerLabel}</Text>
          {errCount > 0 ? <Text style={styles.errBadge}>{errCount} 失败</Text> : null}
          <Ionicons
            name={open ? "chevron-up" : "chevron-down"}
            size={13}
            color={color.textMuted}
          />
        </Pressable>
        <View style={styles.headerLine} />
      </View>

      {open ? (
        <View style={styles.stepList}>
          {groups.map((g, i) => (
            <Pressable
              key={i}
              style={({ pressed }) => [styles.stepRow, pressed && styles.stepRowPressed]}
              onPress={() => {
                setSheetVisible(true);
              }}
            >
              <Text style={[styles.stepLabel, groupHasError(g) ? styles.stepLabelErr : null]}>
                {processGroupLabel(g)}
              </Text>
              <Ionicons name="chevron-forward" size={13} color={color.textMuted} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <Modal
        visible={sheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setSheetVisible(false);
        }}
      >
        <View style={styles.sheetOverlay}>
          <Pressable
            style={styles.sheetBackdrop}
            onPress={() => {
              setSheetVisible(false);
            }}
          />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>详情</Text>
              <Pressable
                style={({ pressed }) => [styles.sheetClose, pressed && styles.sheetClosePressed]}
                onPress={() => {
                  setSheetVisible(false);
                }}
                hitSlop={8}
              >
                <Ionicons name="close" size={20} color={color.textSecondary} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {groups.map((g, i) => (
                <SheetGroup key={i} group={g} isLast={i === groups.length - 1} />
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "stretch",
    marginVertical: spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  headerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.borderStrong,
  },
  headerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  headerBtnPressed: { backgroundColor: brand.cream },
  headerLabel: {
    fontSize: fontSize.caption,
    color: color.textSecondary,
    fontWeight: fontWeight.medium,
  },
  errBadge: {
    fontSize: 11,
    color: color.danger,
    fontWeight: fontWeight.medium,
  },
  stepList: {
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 7,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  stepRowPressed: { backgroundColor: brand.cream },
  stepLabel: {
    fontSize: fontSize.body,
    color: color.textSecondary,
    flexShrink: 1,
  },
  stepLabelErr: { color: color.danger },
  sheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(43, 38, 32, 0.45)",
  },
  sheet: {
    backgroundColor: color.bgElevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "86%",
    ...shadow.floating,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.borderStrong,
    marginTop: spacing.sm,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
  },
  sheetTitle: {
    fontSize: fontSize.title,
    fontWeight: fontWeight.semibold,
    color: color.textPrimary,
  },
  sheetClose: {
    position: "absolute",
    right: spacing.lg,
    padding: 2,
    borderRadius: radius.pill,
  },
  sheetClosePressed: { backgroundColor: brand.cream },
  sheetScroll: { flexGrow: 0 },
  sheetScrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  sheetGroup: {
    flexDirection: "row",
    gap: spacing.md,
  },
  sheetRail: {
    width: 28,
    alignItems: "center",
  },
  sheetIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: brand.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetIconCircleErr: { backgroundColor: color.dangerBg },
  sheetRailLine: {
    flex: 1,
    width: StyleSheet.hairlineWidth,
    backgroundColor: color.borderStrong,
    marginVertical: spacing.xs,
  },
  sheetGroupBody: {
    flex: 1,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  sheetGroupTitle: {
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
    color: color.textPrimary,
    lineHeight: 28,
  },
  sheetThinking: {
    fontSize: fontSize.caption,
    color: color.textSecondary,
    lineHeight: 19,
  },
  sheetToolItem: { gap: 4 },
  sheetToolHeadRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  sheetToolHead: {
    flex: 1,
    fontSize: fontSize.caption,
    color: color.textPrimary,
    fontFamily: "Menlo",
    lineHeight: 18,
  },
  sheetToolHeadErr: { color: color.danger },
  sheetElapsed: {
    fontSize: 11,
    color: color.textMuted,
    marginLeft: "auto",
  },
  sheetPreview: {
    fontSize: fontSize.caption,
    color: color.textMuted,
    lineHeight: 17,
    paddingLeft: 20,
  },
});
