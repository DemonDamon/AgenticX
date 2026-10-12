import { Stack, router } from "expo-router";
import { useCallback, useState } from "react";
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
import { BrandMark } from "../src/ui/BrandMark";
import { brand, color, fontSize, fontWeight, radius, shadow, spacing } from "../src/ui/theme";

/**
 * 新建任务页（懒创建）：
 * - 进入不创建会话；首条消息发出时 createSession → replace 到会话页并带 initialText 自动发送
 * - 放弃不产生垃圾会话；创建失败保留输入 + toast
 */
export default function NewTaskScreen() {
  const insets = useSafeAreaInsets();
  const { client } = useGateway();
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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

  return (
    <View style={styles.page}>
      <Stack.Screen options={{ title: "新建任务" }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.hero}>
          <BrandMark size={56} plated />
          <Text style={styles.heroTitle}>新建任务</Text>
          <Text style={styles.heroSub}>Near, Always Near.</Text>
        </View>

        <View style={styles.inputCard}>
          <TextInput
            style={styles.input}
            multiline
            autoFocus
            placeholder="想让 Near 做什么？"
            placeholderTextColor={color.textMuted}
            value={draft}
            onChangeText={setDraft}
            editable={!creating}
          />
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
              <Text style={styles.sendButtonText}>开始</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.capabilityWrap}>
          <CapabilityCard client={client} />
        </View>
      </KeyboardAvoidingView>

      {toast !== null ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
      {/* insets.bottom 保底：内容区避开手势条 */}
      <View style={{ height: Math.max(insets.bottom, 8) }} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  hero: {
    alignItems: "center",
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },
  heroTitle: {
    fontSize: fontSize.h2,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
    marginTop: spacing.sm,
  },
  heroSub: { fontSize: fontSize.caption, color: color.textMuted, letterSpacing: 1 },
  inputCard: {
    marginHorizontal: spacing.lg,
    backgroundColor: "#FFFFFF",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.md,
    gap: spacing.md,
    ...shadow.card,
  },
  input: {
    minHeight: 96,
    maxHeight: 180,
    fontSize: fontSize.bodyLg,
    color: color.textPrimary,
    lineHeight: 22,
    textAlignVertical: "top",
  },
  sendButton: {
    backgroundColor: brand.primary,
    borderRadius: radius.pill,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  sendPressed: { backgroundColor: brand.primaryPressed },
  sendDisabled: { opacity: 0.4 },
  sendButtonText: {
    color: "#FFFFFF",
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
  },
  capabilityWrap: { marginTop: spacing.lg, paddingHorizontal: spacing.lg, flex: 1 },
  toast: {
    position: "absolute",
    bottom: 120,
    alignSelf: "center",
    backgroundColor: "rgba(43, 38, 32, 0.92)",
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    maxWidth: "82%",
  },
  toastText: { color: "#FFFFFF", fontSize: fontSize.body },
});
