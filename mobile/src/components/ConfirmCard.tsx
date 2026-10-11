import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { GatewayClient } from "../api/client";
import type { MobileConfirm } from "../api/types";
import { usePolling } from "../hooks/usePolling";
import { notifyConfirmsChanged, onConfirmsChanged } from "../lib/events";
import { describeError } from "../lib/errors";
import { BrandMark } from "../ui/BrandMark";
import { brand, color, fontSize, fontWeight, radius, shadow, spacing } from "../ui/theme";

function createdAtMs(confirm: MobileConfirm): number {
  const v = confirm.created_at;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

interface ConfirmCardProps {
  /** 未绑定时传 null：不轮询、不渲染 */
  client: GatewayClient | null;
}

/**
 * 全局审批悬浮卡（挂 _layout，所有页面可见）：
 * - 5s 轮询 GET /api/mobile/confirms（仅已绑定）
 * - 多个 pending 取 created_at 最新一个（桌面单 agent 串行，实际不并发）
 * - 决策成功 → 本地立即消失 + 广播 confirmsChanged（消息页刷新）
 * - 轮询错误记入 state；无卡时不渲染（有卡时显示「刷新失败」）
 */
export function ConfirmCard({ client }: ConfirmCardProps) {
  const insets = useSafeAreaInsets();
  const [confirm, setConfirm] = useState<MobileConfirm | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");

  const fetchConfirms = useCallback(async () => {
    if (client === null) return;
    const resp = await client.getConfirms();
    const list = [...resp.confirms].sort((a, b) => createdAtMs(b) - createdAtMs(a));
    setConfirm(list[0] ?? null);
  }, [client]);

  usePolling({
    intervalMs: 5_000,
    enabled: client !== null,
    onPoll: async () => {
      await fetchConfirms();
      setError(null);
    },
    onError: (err) => {
      setError(describeError(err));
    },
  });

  // send 响应含 pending_confirm / 其它决策完成 → 立即重拉
  useEffect(() => onConfirmsChanged(() => {
    void fetchConfirms().catch(() => {
      // 立即重拉的失败同样进 error state，不静默吞掉
      setError("审批状态刷新失败");
    });
  }), [fetchConfirms]);

  const decide = useCallback(
    async (approved: boolean) => {
      if (confirm === null || client === null || submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        await client.decideConfirm(confirm.request_id, {
          approved,
          reason: approved || reason.trim() === "" ? undefined : reason.trim(),
        });
        setConfirm(null);
        setReasonOpen(false);
        setReason("");
        notifyConfirmsChanged();
      } catch (err) {
        setError(describeError(err));
      } finally {
        setSubmitting(false);
      }
    },
    [confirm, client, submitting, reason],
  );

  if (confirm === null) return null;

  return (
    <View style={[styles.card, { top: insets.top + 60 }]} pointerEvents="box-none">
      <View style={styles.cardInner}>
        <View style={styles.accentBar} />
        <View style={styles.headerRow}>
          <View style={styles.headerTitle}>
            <BrandMark size={22} />
            <Text style={styles.headerText}>需要审批</Text>
          </View>
          {submitting ? <ActivityIndicator size="small" color={brand.primary} /> : null}
        </View>
        <Text style={styles.question}>{confirm.question}</Text>

        {reasonOpen ? (
          <TextInput
            style={styles.reasonInput}
            placeholder="拒绝原因（可选）"
            placeholderTextColor={color.textMuted}
            multiline
            value={reason}
            onChangeText={setReason}
            editable={!submitting}
          />
        ) : null}

        {error !== null ? <Text style={styles.errorText}>{error}</Text> : null}

        <View style={styles.buttonRow}>
          <Pressable
            style={({ pressed }) => [
              styles.button,
              styles.approveButton,
              submitting ? styles.buttonDisabled : null,
              pressed ? styles.approvePressed : null,
            ]}
            disabled={submitting}
            onPress={() => {
              void decide(true);
            }}
          >
            <Text style={styles.approveText}>批准</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.button,
              styles.denyButton,
              submitting ? styles.buttonDisabled : null,
              pressed ? styles.denyPressed : null,
            ]}
            disabled={submitting}
            onPress={() => {
              void decide(false);
            }}
          >
            <Text style={styles.denyText}>拒绝</Text>
          </Pressable>
        </View>
        <Pressable
          style={styles.reasonToggle}
          disabled={submitting}
          onPress={() => {
            setReasonOpen(!reasonOpen);
          }}
        >
          <Text style={styles.reasonToggleText}>
            {reasonOpen ? "收起原因" : "填写拒绝原因（可选）"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 100,
    elevation: 8,
  },
  cardInner: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm + 2,
    borderWidth: 1,
    borderColor: color.border,
    overflow: "hidden",
    ...shadow.floating,
  },
  accentBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: brand.primary,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.xs,
  },
  headerTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  headerText: {
    fontSize: fontSize.body,
    fontWeight: fontWeight.bold,
    color: brand.primaryDark,
    letterSpacing: 0.5,
  },
  question: {
    fontSize: fontSize.bodyLg,
    color: color.textPrimary,
    lineHeight: 22,
  },
  reasonInput: {
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.bg,
    borderRadius: radius.sm + 2,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    fontSize: fontSize.body,
    color: color.textPrimary,
    maxHeight: 96,
  },
  errorText: {
    fontSize: fontSize.caption,
    color: color.danger,
  },
  buttonRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  button: {
    flex: 1,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    minHeight: 44,
  },
  approveButton: {
    backgroundColor: brand.primary,
  },
  approvePressed: {
    backgroundColor: brand.primaryPressed,
  },
  denyButton: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: color.danger,
  },
  denyPressed: {
    backgroundColor: color.dangerBg,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  approveText: {
    color: "#FFFFFF",
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
  },
  denyText: {
    color: color.danger,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
  },
  reasonToggle: {
    alignItems: "center",
    paddingVertical: 2,
  },
  reasonToggleText: {
    fontSize: fontSize.caption,
    color: color.textSecondary,
  },
});
