import { router } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ApiError } from "../src/api/client";
import { useGateway } from "../src/hooks/useGateway";
import { notifyBindingChanged } from "../src/lib/events";
import { describeError } from "../src/lib/errors";
import { clearBinding } from "../src/store";
import { BrandMark } from "../src/ui/BrandMark";
import { Button } from "../src/ui/Button";
import { brand, color, fontSize, fontWeight, radius, shadow, spacing } from "../src/ui/theme";

/**
 * 绑定管理：显示 device_id / 网关地址，提供解绑。
 * 解绑 = DELETE /api/mobile/bindings → 清本地绑定态 → 广播 → 回配对页。
 */
export default function SettingsScreen() {
  const { client, binding, loadError } = useGateway();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleUnbind = useCallback(async () => {
    if (binding === null || client === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await client.unbind();
      await clearBinding();
      notifyBindingChanged();
      router.replace("/pair");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // 401 已由 useGateway 的 onUnauthorized 统一处理（清绑定 + 跳配对页）
        return;
      }
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }, [binding, client, busy]);

  if (binding === null) {
    if (loadError === null) {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={brand.primary} />
        </View>
      );
    }
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>加载绑定信息失败：{loadError}</Text>
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
          onPress={() => router.replace("/pair")}
        >
          <Text style={styles.secondaryButtonText}>返回配对页</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
      <View style={styles.aboutCard}>
        <BrandMark size={48} />
        <View style={styles.aboutMeta}>
          <Text style={styles.aboutName}>Near Mobile</Text>
          <Text style={styles.aboutTagline}>Near, Always Near.</Text>
        </View>
        <Text style={styles.aboutVersion}>v1.0.0</Text>
      </View>

      <Text style={styles.sectionLabel}>桌面端连接</Text>
      <View style={styles.card}>
        <Text style={styles.mutedLabel}>设备 ID</Text>
        <Text style={styles.value} numberOfLines={1}>
          {binding.device_id}
        </Text>
        <Text style={styles.mutedLabel}>网关地址</Text>
        <Text style={styles.value} numberOfLines={1}>
          {binding.gateway_base}
        </Text>
      </View>

      {error !== null ? (
        <Text style={styles.errorText}>解绑失败：{error}</Text>
      ) : null}

      <Button
        title="解绑此设备"
        variant="danger"
        loading={busy}
        disabled={busy}
        onPress={() => {
          void handleUnbind();
        }}
      />
      <Text style={styles.hintText}>
        解绑后将清除本机的配对信息，需要重新扫码才能连接桌面端。
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: color.bg,
  },
  pageContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    padding: spacing.lg,
    backgroundColor: color.bg,
  },
  aboutCard: {
    backgroundColor: brand.cream,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: brand.creamDeep,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  aboutMeta: {
    flex: 1,
    gap: 2,
  },
  aboutName: {
    fontSize: fontSize.title,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
  },
  aboutTagline: {
    fontSize: fontSize.body,
    color: brand.primaryDark,
    fontWeight: fontWeight.medium,
  },
  aboutVersion: {
    fontSize: fontSize.caption,
    color: color.textMuted,
  },
  sectionLabel: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    color: color.textSecondary,
    letterSpacing: 0.3,
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: color.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 2,
    borderWidth: 1,
    borderColor: color.border,
    ...shadow.card,
  },
  mutedLabel: {
    fontSize: fontSize.caption,
    color: color.textMuted,
    marginTop: spacing.sm,
  },
  value: {
    fontSize: fontSize.body,
    color: color.textPrimary,
  },
  errorText: {
    fontSize: fontSize.body,
    color: color.danger,
    textAlign: "center",
  },
  hintText: {
    fontSize: fontSize.caption,
    color: color.textMuted,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
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
});
