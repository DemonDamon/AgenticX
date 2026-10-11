import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "../../src/api/client";
import type { MobileMessage } from "../../src/api/types";
import { useGateway } from "../../src/hooks/useGateway";
import { notifyConfirmsChanged, onConfirmsChanged } from "../../src/lib/events";
import { describeError } from "../../src/lib/errors";
import { brand, color, fontSize, fontWeight, radius, shadow, spacing } from "../../src/ui/theme";

/**
 * 消息流条目。后端消息无 id 字段，key 用 index+role+ts 组合兜底
 * （同批次 index 唯一，role+ts 降低跨批次碰撞）；本地乐观条目用 `local-` 前缀。
 */
interface ChatEntry {
  key: string;
  role: "user" | "assistant" | "system";
  text: string;
  /** 本回合执行进度（仅本地 send 响应里有，历史消息无） */
  progress?: string[];
  /** 本地发送中的占位气泡 */
  pending?: boolean;
}

/** 后端消息字段名兜底：text → content（弱类型 index signature）。 */
function readText(m: MobileMessage): string {
  const raw = typeof m.text === "string" ? m.text : m.content;
  return typeof raw === "string" ? raw : "";
}

function MessageBubble({ entry }: { entry: ChatEntry }) {
  const [progressOpen, setProgressOpen] = useState(false);

  if (entry.role === "system") {
    return (
      <View style={styles.systemWrap}>
        <Text style={styles.systemText}>{entry.text}</Text>
      </View>
    );
  }

  const isUser = entry.role === "user";
  return (
    <View
      style={[
        styles.bubbleColumn,
        isUser ? styles.bubbleColumnUser : styles.bubbleColumnAssistant,
      ]}
    >
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        {entry.pending === true ? (
          <View style={styles.pendingRow}>
            <ActivityIndicator size="small" color={brand.primary} />
            <Text style={styles.pendingText}>正在执行…</Text>
          </View>
        ) : (
          <Text style={isUser ? styles.bubbleUserText : styles.bubbleAssistantText}>
            {entry.text}
          </Text>
        )}
      </View>
      {entry.progress !== undefined && entry.progress.length > 0 ? (
        <Pressable
          style={styles.progressToggle}
          onPress={() => {
            setProgressOpen(!progressOpen);
          }}
        >
          <Text style={styles.progressToggleText}>
            {progressOpen ? "收起进度" : `执行进度（${entry.progress.length}）`}
          </Text>
        </Pressable>
      ) : null}
      {progressOpen && entry.progress !== undefined ? (
        <View style={styles.progressBox}>
          {entry.progress.map((line, i) => (
            <Text key={`${i}-${line.slice(0, 12)}`} style={styles.progressLine}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * 消息流（动态路由 /sessions/{id}）：
 * - 进入拉一次 messages；审批决策完成事件触发刷新
 * - 发送：乐观「正在执行」占位 → 成功追加 user+assistant(progress) → 失败移除占位 + toast + 草稿保留
 * - pending_confirm 非空 → 广播事件让全局审批卡立即拉取
 */
export default function SessionMessagesScreen() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const insets = useSafeAreaInsets();
  const { client } = useGateway();

  const [entries, setEntries] = useState<ChatEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      setToast(null);
    }, 2_500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    };
  }, []);

  const fetchMessages = useCallback(async () => {
    if (client === null) return;
    const resp = await client.getMessages(id);
    setEntries(
      resp.messages.map((m, i) => ({
        key: `${i}-${m.role}-${m.ts ?? "nots"}`,
        role: m.role,
        text: readText(m),
      })),
    );
  }, [client, id]);

  useEffect(() => {
    void fetchMessages().catch((err: unknown) => {
      setLoadError(describeError(err));
    });
  }, [fetchMessages]);

  // 审批决策完成（全局卡 approve/deny）→ 立即刷新本会话消息
  useEffect(
    () =>
      onConfirmsChanged(() => {
        void fetchMessages().catch((err: unknown) => {
          showToast(`刷新失败：${describeError(err)}`);
        });
      }),
    [fetchMessages, showToast],
  );

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (text === "" || sending || client === null) return;
    setSending(true);
    const pendingKey = `local-pending-${Date.now()}`;
    setEntries((prev) => [
      ...(prev ?? []),
      { key: pendingKey, role: "assistant", text: "", pending: true },
    ]);
    try {
      const resp = await client.sendMessage(id, { text, sender_name: "Near 手机" });
      const ts = Date.now();
      setEntries((prev) => [
        ...(prev ?? []).filter((e) => e.key !== pendingKey),
        { key: `local-user-${ts}`, role: "user", text },
        {
          key: `local-reply-${ts}`,
          role: "assistant",
          text: resp.reply,
          progress: resp.progress.length > 0 ? resp.progress : undefined,
        },
      ]);
      setDraft("");
      if (resp.pending_confirm !== null) {
        notifyConfirmsChanged();
      }
    } catch (err) {
      setEntries((prev) => (prev ?? []).filter((e) => e.key !== pendingKey));
      if (!(err instanceof ApiError && err.status === 401)) {
        // 401 已由 useGateway 的 onUnauthorized 统一处理（清绑定 + 跳配对页）
        showToast(`发送失败：${describeError(err)}`);
      }
    } finally {
      setSending(false);
    }
  }, [draft, sending, client, id, showToast]);

  // inverted 列表：数据倒序 + 容器翻转 = 视觉正序、最新贴底
  const displayData = useMemo(
    () => (entries === null ? [] : [...entries].reverse()),
    [entries],
  );

  const pageTitle = typeof title === "string" && title !== "" ? title : "会话";
  const canSend = sending || draft.trim() === "";

  return (
    <View style={styles.page}>
      <Stack.Screen options={{ title: pageTitle }} />

      {entries === null ? (
        loadError !== null ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>消息加载失败：{loadError}</Text>
            <Pressable
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
              onPress={() => {
                setLoadError(null);
                void fetchMessages().catch((err: unknown) => {
                  setLoadError(describeError(err));
                });
              }}
            >
              <Text style={styles.secondaryButtonText}>重试</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={brand.primary} />
          </View>
        )
      ) : entries.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>还没有消息</Text>
          <Text style={styles.emptySubText}>在下方输入框发条指令试试</Text>
        </View>
      ) : (
        <FlatList<ChatEntry>
          data={displayData}
          inverted
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => <MessageBubble entry={item} />}
        />
      )}

      {entries !== null ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
        >
          <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            <TextInput
              style={styles.input}
              multiline
              placeholder="给 Near 发指令…"
              placeholderTextColor={color.textMuted}
              value={draft}
              onChangeText={setDraft}
              editable={!sending}
            />
            <Pressable
              style={({ pressed }) => [
                styles.sendButton,
                canSend ? styles.sendDisabled : null,
                pressed && !canSend ? styles.sendPressed : null,
              ]}
              disabled={canSend}
              onPress={() => {
                void handleSend();
              }}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.sendButtonText}>发送</Text>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      ) : null}

      {toast !== null ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: color.bg,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.xl,
  },
  emptyText: {
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.medium,
    color: color.textSecondary,
  },
  emptySubText: {
    fontSize: fontSize.body,
    color: color.textMuted,
  },
  errorText: {
    fontSize: fontSize.body,
    color: color.danger,
    textAlign: "center",
  },
  systemWrap: {
    alignItems: "center",
    paddingVertical: spacing.xs,
  },
  systemText: {
    fontSize: fontSize.caption,
    color: color.textMuted,
    textAlign: "center",
  },
  bubbleColumn: {
    maxWidth: "84%",
    marginVertical: spacing.xs,
  },
  bubbleColumnUser: {
    alignSelf: "flex-end",
    alignItems: "flex-end",
  },
  bubbleColumnAssistant: {
    alignSelf: "flex-start",
    alignItems: "flex-start",
  },
  bubble: {
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg - 2,
    paddingVertical: spacing.sm + 2,
  },
  bubbleUser: {
    backgroundColor: brand.primary,
    borderBottomRightRadius: 4,
    ...shadow.card,
  },
  bubbleAssistant: {
    backgroundColor: color.bubbleAssistant,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: color.border,
  },
  bubbleUserText: {
    fontSize: fontSize.bodyLg,
    color: "#FFFFFF",
    lineHeight: 22,
  },
  bubbleAssistantText: {
    fontSize: fontSize.bodyLg,
    color: color.textPrimary,
    lineHeight: 22,
  },
  pendingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  pendingText: {
    fontSize: fontSize.body,
    color: brand.primaryDark,
    fontWeight: fontWeight.medium,
  },
  progressToggle: {
    marginTop: spacing.xs,
    paddingVertical: 2,
  },
  progressToggleText: {
    fontSize: fontSize.caption,
    color: brand.primary,
    fontWeight: fontWeight.medium,
  },
  progressBox: {
    backgroundColor: brand.cream,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm + 2,
    padding: spacing.sm + 2,
    marginTop: spacing.xs,
    gap: spacing.xs,
    alignSelf: "stretch",
  },
  progressLine: {
    fontSize: fontSize.caption,
    color: color.textSecondary,
    lineHeight: 18,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: "#FFFFFF",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: color.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm + 2,
    paddingBottom: spacing.sm + 2,
    fontSize: fontSize.bodyLg,
    color: color.textPrimary,
    maxHeight: 120,
    backgroundColor: color.bg,
  },
  sendButton: {
    backgroundColor: brand.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minWidth: 64,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  sendPressed: {
    backgroundColor: brand.primaryPressed,
  },
  sendDisabled: {
    opacity: 0.4,
  },
  sendButtonText: {
    color: "#FFFFFF",
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
  },
  secondaryButton: {
    borderWidth: 1.5,
    borderColor: brand.primary,
    borderRadius: radius.md,
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: spacing.xl,
    backgroundColor: "#FFFFFF",
  },
  buttonPressed: {
    backgroundColor: brand.cream,
  },
  secondaryButtonText: {
    color: brand.primary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
  },
  toast: {
    position: "absolute",
    bottom: 96,
    alignSelf: "center",
    backgroundColor: "rgba(43, 38, 32, 0.92)",
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    maxWidth: "82%",
  },
  toastText: {
    color: "#FFFFFF",
    fontSize: fontSize.body,
  },
});
