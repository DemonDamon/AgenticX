import { Stack, useLocalSearchParams } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  buildChatEntries,
  applyStreamDelta,
  visibleStreamText,
  type ChatEntry,
} from "../../src/lib/messages";
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

// memo：打字/发送等页面级 state 变化时，未变化的消息项（尤其 Markdown）跳过重渲染
const MessageItem = memo(function MessageItem({ entry }: { entry: ChatEntry }) {
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
    case "streaming": {
      // 回合进行中的 token 增量：纯 Text 轻量渲染（避免 Markdown 高频重解析），
      // 回合结束由 fetchMessages 的结构化终态替换。思考块原文（<thinking>）
      // 剥除不外显；剥后为空（思考阶段）显示占位提示。
      const visible = visibleStreamText(entry.text);
      return (
        <View style={[styles.bubble, styles.bubbleAssistant]}>
          {visible.trim() === "" ? (
            <View style={styles.pendingRow}>
              <ActivityIndicator size="small" color={brand.primary} />
              <Text style={styles.pendingText}>思考中…</Text>
            </View>
          ) : (
            <Text style={styles.bubbleAssistantText}>{visible}</Text>
          )}
        </View>
      );
    }
  }
});

/**
 * 底部输入条：draft 状态隔离在组件内部，敲字只重渲染本组件，
 * 不再触发整页（消息列表 / Markdown 重解析）重渲染。
 */
function Composer({
  sending,
  onSend,
}: {
  sending: boolean;
  onSend: (text: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const insets = useSafeAreaInsets();
  const canSend = sending || draft.trim() === "";

  const submit = useCallback(() => {
    const text = draft.trim();
    if (text === "" || sending) return;
    void onSend(text).then((ok) => {
      if (ok) setDraft("");
    });
  }, [draft, sending, onSend]);

  return (
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
        onPress={submit}
      >
        {sending ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text style={styles.sendButtonText}>发送</Text>
        )}
      </Pressable>
    </View>
  );
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
  const { client } = useGateway();

  const [entries, setEntries] = useState<ChatEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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
    async (text: string): Promise<boolean> => {
      if (text === "" || sending || client === null) return false;
      setSending(true);
      const pendingKey = `local-pending-${Date.now()}`;
      const pendingEntry: ChatEntry = { kind: "pending", key: pendingKey };
      setEntries((prev) => [...(prev ?? []), pendingEntry]);
      // 打字机平滑：网络帧（桌面侧 120ms 节流聚合）较粗，直接上屏是
      // 10+ 字一帧的跳变。这里把增量拆成字符入队，按 ~45ms/帧 匀速消费
      // 呈现逐字打字机效果；仅当积压严重（模型产出远快于播放）才升速
      // 追赶，短回复始终保有可感知的打字节奏。回合结束不 flush 余量，
      // 而是等队列播空（waitSmoothDrain）再做终态替换，避免终局跳变。
      const smoothBuf: string[] = [];
      let smoothTimer: ReturnType<typeof setInterval> | null = null;
      let smoothDoneResolve: (() => void) | null = null;
      const consumeSmooth = () => {
        if (smoothBuf.length === 0) {
          if (smoothTimer !== null) {
            clearInterval(smoothTimer);
            smoothTimer = null;
          }
          if (smoothDoneResolve !== null) {
            const resolve = smoothDoneResolve;
            smoothDoneResolve = null;
            resolve();
          }
          return;
        }
        const take =
          smoothBuf.length > 150 ? 4 : smoothBuf.length > 60 ? 3 : smoothBuf.length > 25 ? 2 : 1;
        const piece = smoothBuf.splice(0, take).join("");
        setEntries((prev) => applyStreamDelta(prev, pendingKey, piece));
      };
      const stopSmooth = () => {
        if (smoothTimer !== null) {
          clearInterval(smoothTimer);
          smoothTimer = null;
        }
        smoothDoneResolve = null;
      };
      const waitSmoothDrain = () =>
        new Promise<void>((resolve) => {
          if (smoothTimer === null && smoothBuf.length === 0) {
            resolve();
            return;
          }
          smoothDoneResolve = resolve;
          // 兜底：队列异常播不空（不应发生）时强制放行，避免 sending 卡死
          setTimeout(resolve, 30_000);
        });
      // 真流式：订阅回合 token 流（WS turn_delta），增量入队平滑上屏；
      // 连接失败静默降级为下面的轮询伪流式，不影响回合本身
      const streamHandle = client.openTurnStream(id, {
        onDelta: (delta) => {
          smoothBuf.push(...delta);
          if (smoothTimer === null) {
            smoothTimer = setInterval(consumeSmooth, 45);
          }
        },
      });
      // 伪流式：回合进行中每 2s 拉一次消息。桌面端在工具调用之间会增量落盘
      // （incremental_persist），工具步骤得以逐步上屏；服务端尚未写入本条
      // 用户消息前不应用快照，避免本地乐观 user 消息被旧快照顶掉。
      let polling = true;
      let pollInFlight = false;
      const pollTimer = setInterval(() => {
        if (!polling || pollInFlight || client === null) return;
        pollInFlight = true;
        void client
          .getMessages(id)
          .then((resp) => {
            if (!polling) return;
            const caughtUp = resp.messages.some(
              (m) =>
                m.role === "user" &&
                typeof m.content === "string" &&
                m.content.trim() === text,
            );
            if (!caughtUp) return;
            // 快照重建历史/工具步骤，尾部 live 条目（pending / streaming 气泡）保留
            setEntries((prev) => {
              const live = (prev ?? []).filter(
                (e) => e.key === pendingKey || e.kind === "streaming",
              );
              return [...buildChatEntries(resp.messages), ...live];
            });
          })
          .catch(() => {
            // 轮询失败静默：回合结束后的 fetchMessages 才是最终真相
          })
          .finally(() => {
            pollInFlight = false;
          });
      }, 2000);
      try {
        const resp = await client.sendMessage(id, { text, sender_name: "Near 手机" });
        polling = false;
        clearInterval(pollTimer);
        // 回合结束：打字机余量按节奏播完（不 flush 跳变），再做终态结构化替换
        await waitSmoothDrain();
        if (resp.pending_confirm !== null) {
          notifyConfirmsChanged();
        }
        // 完成态结构化：从后端拉真实消息线（tool 分组 + reasoning + Markdown），
        // 整体替换本地 pending / streaming 条目
        try {
          await fetchMessages();
          // 延迟补拉 ×2：长回合的收尾消息可能在 send 返回后才落盘
          // （桌面 SSE 先关流、summary 后写盘），+5s/+15s 兜底补齐
          setTimeout(() => {
            void fetchMessages().catch(() => undefined);
          }, 5000);
          setTimeout(() => {
            void fetchMessages().catch(() => undefined);
          }, 15_000);
        } catch {
          setEntries((prev) => [
            ...(prev ?? []).filter((e) => e.key !== pendingKey && e.kind !== "streaming"),
            { kind: "assistant", key: `local-reply-${Date.now()}`, text: resp.reply },
          ]);
        }
        return true;
      } catch (err) {
        stopSmooth();
        setEntries((prev) =>
          (prev ?? []).filter((e) => e.key !== pendingKey && e.kind !== "streaming"),
        );
        if (!(err instanceof ApiError && err.status === 401)) {
          // 401 已由 useGateway 的 onUnauthorized 统一处理（清绑定 + 跳配对页）
          showToast(`发送失败：${describeError(err)}`);
        }
        return false;
      } finally {
        polling = false;
        clearInterval(pollTimer);
        stopSmooth();
        streamHandle?.close();
        setSending(false);
      }
    },
    [sending, client, id, showToast, fetchMessages],
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

  // 稳定的 renderItem：配合 memo 的 MessageItem，页面 state 变化不重渲染消息项
  const renderItem = useCallback(
    ({ item }: { item: ChatEntry }) => <MessageItem entry={item} />,
    [],
  );

  const pageTitle = typeof title === "string" && title !== "" ? title : "会话";

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
          renderItem={renderItem}
        />
      )}

      {entries !== null ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
        >
          <Composer sending={sending} onSend={handleSend} />
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
