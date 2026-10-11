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
import { AssistantMarkdown } from "../../src/components/AssistantMarkdown";
import { ReasoningBlock } from "../../src/components/ReasoningBlock";
import { ToolGroupCard } from "../../src/components/ToolGroupCard";
import { useGateway } from "../../src/hooks/useGateway";
import { notifyConfirmsChanged, onConfirmsChanged } from "../../src/lib/events";
import { describeError } from "../../src/lib/errors";
import { buildChatEntries, type ChatEntry } from "../../src/lib/messages";
import { brand, color, fontSize, fontWeight, radius, shadow, spacing } from "../../src/ui/theme";

function PendingBubble() {
  return (
    <View style={[styles.bubble, styles.bubbleAssistant]}>
      <View style={styles.pendingRow}>
        <ActivityIndicator size="small" color={brand.primary} />
        <Text style={styles.pendingText}>正在执行…</Text>
      </View>
    </View>
  );
}

function AssistantBlock({ text, reasoning }: { text: string; reasoning?: string }) {
  return (
    <View style={styles.bubbleColumn}>
      {reasoning !== undefined ? (
        <View style={styles.reasoningWrap}>
          <ReasoningBlock text={reasoning} />
        </View>
      ) : null}
      <View style={[styles.bubble, styles.bubbleAssistant]}>
        {text.trim() === "" ? (
          <Text style={styles.bubbleAssistantText}>（无文本回复）</Text>
        ) : (
          <AssistantMarkdown text={text} />
        )}
      </View>
    </View>
  );
}

function MessageItem({ entry }: { entry: ChatEntry }) {
  switch (entry.kind) {
    case "user":
      return (
        <View style={styles.bubbleColumnUser}>
          <View style={[styles.bubble, styles.bubbleUser]}>
            <Text style={styles.bubbleUserText}>{entry.text}</Text>
          </View>
        </View>
      );
    case "assistant":
      return <AssistantBlock text={entry.text} reasoning={entry.reasoning} />;
    case "system":
      return (
        <View style={styles.systemWrap}>
          <Text style={styles.systemText}>{entry.text}</Text>
        </View>
      );
    case "toolGroup":
      return (
        <View style={styles.toolGroupWrap}>
          <ToolGroupCard steps={entry.steps} />
        </View>
      );
    case "pending":
      return <PendingBubble />;
  }
}

/**
 * 消息流（动态路由 /sessions/{id}）：
 * - 进入拉一次 messages；审批决策完成事件触发刷新
 * - 发送：乐观「正在执行」占位 → 成功后重拉消息线渲染结构化时间线
 *   （Markdown / 工具分组卡 / 思考折叠）；重拉失败回退纯文本 reply
 * - pending_confirm 非空 → 广播事件让全局审批卡立即拉取
 * - initialText：懒创建链路（new-task 页 replace 携带）自动发送首条消息
 */
export default function SessionMessagesScreen() {
  const { id, title, initialText } = useLocalSearchParams<{
    id: string;
    title?: string;
    initialText?: string;
  }>();
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
    setEntries(buildChatEntries(resp.messages));
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

  const handleSend = useCallback(
    async (override?: string) => {
      const text = (override ?? draft).trim();
      if (text === "" || sending || client === null) return;
      setSending(true);
      const pendingKey = `local-pending-${Date.now()}`;
      setEntries((prev) => [...(prev ?? []), { kind: "pending", key: pendingKey }]);
      try {
        const resp = await client.sendMessage(id, { text, sender_name: "Near 手机" });
        setDraft("");
        if (resp.pending_confirm !== null) {
          notifyConfirmsChanged();
        }
        // 完成态结构化：从后端拉真实消息线（tool 分组 + reasoning + Markdown）
        try {
          await fetchMessages();
        } catch {
          setEntries((prev) => [
            ...(prev ?? []).filter((e) => e.key !== pendingKey),
            { kind: "assistant", key: `local-reply-${Date.now()}`, text: resp.reply },
          ]);
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
    },
    [draft, sending, client, id, showToast, fetchMessages],
  );

  // 懒创建链路收口：new-task 页 replace 过来时带 initialText 自动发送首条消息
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (
      typeof initialText === "string" &&
      initialText.trim() !== "" &&
      !autoSentRef.current &&
      client !== null
    ) {
      autoSentRef.current = true;
      void handleSend(initialText.trim());
    }
  }, [initialText, client, handleSend]);

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
          renderItem={({ item }) => <MessageItem entry={item} />}
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
    maxWidth: "84%",
    marginVertical: spacing.xs,
  },
  reasoningWrap: {
    alignSelf: "stretch",
    maxWidth: "100%",
    marginBottom: spacing.xs,
  },
  toolGroupWrap: { maxWidth: "92%", alignSelf: "flex-start" },
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
