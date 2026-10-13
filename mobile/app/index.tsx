import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CapabilityCard } from "../src/components/CapabilityCard";
import { useGateway } from "../src/hooks/useGateway";
import { describeError } from "../src/lib/errors";
import type { MobileStatus } from "../src/api/types";
import { brand, color, fontSize, fontWeight, radius, shadow, spacing } from "../src/ui/theme";

/**
 * 首页（对标 Trae / Claude 手机端）：打开 APP 直达对话起始页。
 * - 大标语 + 底部输入卡（动作行：＋能力速览 / 模型 pill / 发送）+ 设备上下文 pill 行
 * - 首条消息发出时懒创建会话；左上角入口 → 「全部任务」列表
 * - 未绑定 → pair；绑定读取中先展示轻量分发
 */
export default function Index() {
  const insets = useSafeAreaInsets();
  const { client, binding, loadError } = useGateway();
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<MobileStatus | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [capsOpen, setCapsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // 拉桌面状态（在线/桌面名）+ 最近会话的模型（动作行 pill），失败静默降级
  useEffect(() => {
    if (client === null) return;
    let cancelled = false;
    void client
      .getStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {});
    void client
      .getSessions()
      .then((resp) => {
        const first = resp.sessions[0];
        if (!cancelled && first !== undefined && typeof first.model === "string") {
          setModel(first.model);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client]);

  const handleStart = useCallback(async () => {
    const text = draft.trim();
    if (text === "" || creating || client === null) return;
    setCreating(true);
    try {
      const resp = await client.createSession({});
      router.push({
        pathname: "/sessions/[id]",
        params: { id: resp.session_id, title: text.slice(0, 20), initialText: text },
      });
    } catch (err) {
      setToast(`创建任务失败：${describeError(err)}`);
      setCreating(false);
      setTimeout(() => {
        setToast(null);
      }, 2_500);
    }
  }, [draft, creating, client]);

  const canSend = creating || draft.trim() === "";

  // 未绑定 / 绑定读取失败：轻量分发（真正 UI 是配对页）
  if (binding === null) {
    return (
      <View style={styles.center}>
        {loadError === null ? (
          <ActivityIndicator size="large" color={brand.primary} />
        ) : (
          <>
            <Text style={styles.centerError}>初始化失败：{loadError}</Text>
            <Pressable
              style={({ pressed }) => [styles.pairButton, pressed && styles.pairPressed]}
              onPress={() => router.replace("/pair")}
            >
              <Text style={styles.pairButtonText}>去配对</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  const desktopName = status?.desktop_name ?? "桌面端";
  const online = status?.online === true;

  return (
    <View style={styles.page}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* 左上角：全部任务入口 */}
        <View style={[styles.topBar, { paddingTop: insets.top + spacing.xs }]}>
          <Pressable
            style={({ pressed }) => [styles.listEntry, pressed && styles.listEntryPressed]}
            onPress={() => {
              router.push("/sessions");
            }}
            hitSlop={8}
          >
            <Ionicons name="chevron-back" size={22} color={color.textPrimary} />
          </Pressable>
        </View>

        {/* 大标语 */}
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Hey，我是 Near</Text>
          <Text style={styles.heroSub}>桌面智能体，随时待命</Text>
          <View style={styles.heroStatus}>
            <View
              style={[
                styles.statusDot,
                status === null ? styles.statusDotMuted : online ? styles.statusDotOnline : styles.statusDotOffline,
              ]}
            />
            <Text style={styles.heroStatusText}>
              {status === null ? "正在连接桌面端…" : `${desktopName} · ${online ? "在线" : "离线"}`}
            </Text>
          </View>
        </View>

        {/* ＋ 展开：能力速览 */}
        {capsOpen ? (
          <View style={styles.capsWrap}>
            <CapabilityCard client={client} />
          </View>
        ) : null}

        {/* 底部输入卡（对标 Trae/Claude 层次：输入区 → 动作行） */}
        <View style={styles.inputCard}>
          <TextInput
            style={styles.input}
            multiline
            placeholder="发消息给 Near…"
            placeholderTextColor={color.textMuted}
            value={draft}
            onChangeText={setDraft}
            editable={!creating}
          />
          <View style={styles.actionRow}>
            <Pressable
              style={({ pressed }) => [styles.iconButton, pressed && styles.iconPressed]}
              onPress={() => {
                setCapsOpen((v) => !v);
              }}
              hitSlop={6}
            >
              <Ionicons name={capsOpen ? "close" : "add"} size={22} color={color.textSecondary} />
            </Pressable>
            {model !== null ? (
              <View style={styles.modelPill}>
                <Ionicons name="sparkles" size={12} color={brand.primary} />
                <Text style={styles.modelPillText} numberOfLines={1}>
                  {model}
                </Text>
                <Ionicons name="chevron-down" size={12} color={color.textMuted} />
              </View>
            ) : null}
            <View style={styles.spacer} />
            <Pressable
              style={({ pressed }) => [
                styles.sendButton,
                canSend ? styles.sendDisabled : null,
                pressed && !canSend ? styles.sendPressed : null,
              ]}
              disabled={canSend}
              onPress={() => {
                void handleStart();
              }}
            >
              {creating ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
              )}
            </Pressable>
          </View>
        </View>

        {/* 设备上下文 pill 行 */}
        <View style={styles.contextRow}>
          <Pressable
            style={({ pressed }) => [styles.contextPill, pressed && styles.contextPillPressed]}
            onPress={() => {
              router.push("/settings");
            }}
          >
            <Ionicons name="desktop-outline" size={14} color={color.textSecondary} />
            <Text style={styles.contextPillText} numberOfLines={1}>
              {desktopName}
            </Text>
            <Ionicons name="chevron-down" size={12} color={color.textMuted} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.contextPill, pressed && styles.contextPillPressed]}
            onPress={() => {
              router.push("/sessions");
            }}
          >
            <Ionicons name="folder-outline" size={14} color={color.textSecondary} />
            <Text style={styles.contextPillText} numberOfLines={1}>
              AgenticX
            </Text>
            <Ionicons name="chevron-down" size={12} color={color.textMuted} />
          </Pressable>
        </View>
        <View style={{ height: Math.max(insets.bottom, spacing.sm) }} />
      </KeyboardAvoidingView>

      {toast !== null ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    padding: spacing.lg,
    backgroundColor: color.bg,
  },
  centerError: {
    color: color.danger,
    fontSize: fontSize.body,
    textAlign: "center",
  },
  pairButton: {
    borderWidth: 1.5,
    borderColor: brand.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: 11,
    backgroundColor: "#FFFFFF",
  },
  pairPressed: { backgroundColor: brand.cream },
  pairButtonText: {
    color: brand.primary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
  },
  topBar: {
    paddingHorizontal: spacing.lg,
  },
  listEntry: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: color.border,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },
  listEntryPressed: { backgroundColor: brand.cream },
  hero: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xl + 4,
    gap: spacing.xs,
  },
  heroTitle: {
    fontSize: 34,
    lineHeight: 44,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
  },
  heroSub: {
    fontSize: fontSize.bodyLg,
    color: color.textMuted,
    marginTop: spacing.xs,
  },
  heroStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.md,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotOnline: { backgroundColor: color.online },
  statusDotOffline: { backgroundColor: color.offline },
  statusDotMuted: { backgroundColor: color.offline },
  heroStatusText: {
    fontSize: fontSize.body,
    color: color.textSecondary,
  },
  capsWrap: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  inputCard: {
    marginHorizontal: spacing.lg,
    backgroundColor: "#FFFFFF",
    borderRadius: radius.lg + 4,
    borderWidth: 1,
    borderColor: color.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    ...shadow.floating,
  },
  input: {
    minHeight: 56,
    maxHeight: 140,
    fontSize: fontSize.bodyLg,
    color: color.textPrimary,
    lineHeight: 22,
    textAlignVertical: "top",
    paddingHorizontal: spacing.xs,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: color.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  iconPressed: { backgroundColor: brand.cream },
  modelPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: brand.cream,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    height: 32,
    maxWidth: 200,
  },
  modelPillText: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
    color: color.textPrimary,
    flexShrink: 1,
  },
  spacer: { flex: 1 },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: brand.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendPressed: { backgroundColor: brand.primaryPressed },
  sendDisabled: { backgroundColor: color.borderStrong },
  contextRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  contextPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    maxWidth: "48%",
  },
  contextPillPressed: { backgroundColor: brand.cream },
  contextPillText: {
    fontSize: fontSize.caption,
    color: color.textSecondary,
    flexShrink: 1,
  },
  toast: {
    position: "absolute",
    bottom: 140,
    alignSelf: "center",
    backgroundColor: "rgba(43, 38, 32, 0.92)",
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    maxWidth: "82%",
  },
  toastText: { color: "#FFFFFF", fontSize: fontSize.body },
});
