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
import { useGateway } from "../src/hooks/useGateway";
import { describeError } from "../src/lib/errors";
import type { MobileStatus } from "../src/api/types";
import { brand, color, fontSize, fontWeight, radius, shadow, spacing } from "../src/ui/theme";

/**
 * 首页（对标 Trae 手机端）：打开 APP 直达对话起始页。
 * - 大标语 + 底部输入卡；首条消息发出时懒创建会话（不产生垃圾会话）
 * - 左上角入口 → 「全部任务」列表
 * - 未绑定 → pair；绑定读取中先展示标语骨架
 */
export default function Index() {
  const insets = useSafeAreaInsets();
  const { client, binding, loadError } = useGateway();
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<MobileStatus | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 拉一次桌面状态（桌面名 / 在线），失败静默降级
  useEffect(() => {
    if (client === null) return;
    let cancelled = false;
    void client
      .getStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
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
      router.replace({
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

  // 未绑定 / 绑定读取失败：保持轻量分发（真正 UI 是配对页）
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
          <Text style={styles.heroTitle}>代码开发，</Text>
          <Text style={styles.heroTitle}>从这里开始</Text>
          <View style={styles.heroStatus}>
            <View
              style={[
                styles.statusDot,
                status === null ? styles.statusDotMuted : status.online ? styles.statusDotOnline : styles.statusDotOffline,
              ]}
            />
            <Text style={styles.heroStatusText}>
              {status === null ? "正在连接桌面端…" : `${desktopName} · ${status.online ? "在线" : "离线"}`}
            </Text>
          </View>
        </View>

        {/* 底部输入卡 */}
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
          <View style={styles.inputFooter}>
            <Text style={styles.desktopHint} numberOfLines={1}>
              {desktopName}
            </Text>
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
    lineHeight: 46,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
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
  inputCard: {
    marginHorizontal: spacing.lg,
    backgroundColor: "#FFFFFF",
    borderRadius: radius.lg + 4,
    borderWidth: 1,
    borderColor: color.border,
    paddingHorizontal: spacing.lg,
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
  },
  inputFooter: {
    flexDirection: "row",
    alignItems: "center",
  },
  desktopHint: {
    flex: 1,
    fontSize: fontSize.caption,
    color: color.textMuted,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: brand.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendPressed: { backgroundColor: brand.primaryPressed },
  sendDisabled: { backgroundColor: color.borderStrong },
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
