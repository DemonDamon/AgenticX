import { Stack, router } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { MobileSession, MobileStatus } from "../src/api/types";
import { useGateway } from "../src/hooks/useGateway";
import { usePolling } from "../src/hooks/usePolling";
import { formatRelative } from "../src/lib/format";
import { describeError, isDeviceOfflineError } from "../src/lib/errors";
import { BrandMark } from "../src/ui/BrandMark";
import { brand, color, fontSize, fontWeight, radius, shadow, spacing } from "../src/ui/theme";

/**
 * 会话列表：
 * - usePolling 10s 轮询 status（在线徽标）+ sessions（列表）
 * - 下拉刷新；设备离线时列表降级提示（保留旧数据）；网关不可达显式错误态
 * - 点击行进消息流（带 title）
 */
export default function SessionsScreen() {
  const { client, binding, loadError } = useGateway();
  const [status, setStatus] = useState<MobileStatus | null>(null);
  const [sessions, setSessions] = useState<MobileSession[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (client === null) return;
    const s = await client.getStatus();
    setStatus(s);
    setOffline(!s.online);
    try {
      const resp = await client.getSessions();
      setSessions(resp.sessions);
      setListError(null);
    } catch (err) {
      if (isDeviceOfflineError(err)) {
        // 设备离线：保留已缓存的列表，降级提示
        setOffline(true);
      } else {
        throw err;
      }
    }
  }, [client]);

  usePolling({
    intervalMs: 10_000,
    enabled: client !== null,
    onPoll: async () => {
      await fetchAll();
      setListError(null);
    },
    onError: (err) => {
      setListError(describeError(err));
    },
  });

  const onRefresh = useCallback(async () => {
    if (client === null || refreshing) return;
    setRefreshing(true);
    try {
      await fetchAll();
      setListError(null);
    } catch (err) {
      setListError(describeError(err));
    } finally {
      setRefreshing(false);
    }
  }, [client, refreshing, fetchAll]);

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

  const desktopName = status?.desktop_name ?? "桌面端";

  return (
    <View style={styles.page}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              style={({ pressed }) => [styles.plusButton, pressed && styles.plusPressed]}
              onPress={() => {
                router.push("/new-task");
              }}
            >
              <Text style={styles.plusText}>＋</Text>
            </Pressable>
          ),
        }}
      />
      <FlatList
        data={sessions ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={brand.primary}
            colors={[brand.primary]}
          />
        }
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.desktopIdentity}>
                  <BrandMark size={36} />
                  <View style={styles.desktopMeta}>
                    <Text style={styles.desktopName} numberOfLines={1}>
                      {desktopName}
                    </Text>
                    {status !== null ? (
                      <View style={styles.badgeRow}>
                        <View
                          style={[
                            styles.badgeDot,
                            status.online ? styles.badgeDotOnline : styles.badgeDotOffline,
                          ]}
                        />
                        <Text style={styles.badgeText}>{status.online ? "在线" : "离线"}</Text>
                      </View>
                    ) : (
                      <ActivityIndicator size="small" color={brand.primary} />
                    )}
                  </View>
                </View>
              </View>
              <View style={styles.deviceRow}>
                <Text style={styles.mutedLabel}>设备 ID</Text>
                <Text style={styles.deviceId} numberOfLines={1}>
                  {binding.device_id}
                </Text>
              </View>
            </View>

            {offline ? (
              <View style={styles.offlineBanner}>
                <Text style={styles.offlineBannerText}>
                  桌面端离线，显示的可能不是最新数据
                </Text>
              </View>
            ) : null}
            {listError !== null ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>刷新失败：{listError}</Text>
              </View>
            ) : null}
            {sessions !== null && !offline && listError === null ? (
              <Text style={styles.sectionTitle}>会话（{sessions.length}）</Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          sessions === null && listError === null ? (
            <View style={styles.emptyBox}>
              <ActivityIndicator size="large" color={brand.primary} />
            </View>
          ) : sessions !== null && sessions.length === 0 ? (
            <View style={styles.emptyBox}>
              <BrandMark size={64} plated />
              <Text style={styles.emptyText}>桌面还没有会话</Text>
              <Text style={styles.emptySubText}>在桌面端 Near 里开始一段对话后，这里会自动出现</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.sessionRow, pressed ? styles.sessionRowPressed : null]}
            onPress={() => {
              router.push({
                pathname: "/sessions/[id]",
                params: {
                  id: item.id,
                  title: item.title,
                  model: item.model ?? "",
                  sessionMode: item.session_mode ?? "",
                },
              });
            }}
          >
            <View style={styles.sessionRowTop}>
              <Text style={styles.sessionTitle} numberOfLines={1} ellipsizeMode="tail">
                {item.title}
              </Text>
              {item.running === true ? (
                <View style={styles.runningBadge}>
                  <Text style={styles.runningBadgeText}>执行中</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.sessionTime}>{formatRelative(item.updated_at)}</Text>
          </Pressable>
        )}
        ListFooterComponent={
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
            onPress={() => {
              router.push("/settings");
            }}
          >
            <Text style={styles.secondaryButtonText}>绑定与设置</Text>
          </Pressable>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: color.bg,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.sm + 2,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    padding: spacing.lg,
    backgroundColor: color.bg,
  },
  headerBlock: {
    gap: spacing.sm + 2,
  },
  card: {
    backgroundColor: color.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: color.border,
    ...shadow.card,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  desktopIdentity: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    flex: 1,
  },
  desktopMeta: {
    gap: 2,
    flexShrink: 1,
  },
  desktopName: {
    fontSize: fontSize.title,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
    flexShrink: 1,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  badgeDotOnline: {
    backgroundColor: color.online,
  },
  badgeDotOffline: {
    backgroundColor: color.offline,
  },
  badgeText: {
    fontSize: fontSize.caption,
    color: color.textSecondary,
  },
  deviceRow: {
    gap: 2,
  },
  mutedLabel: {
    fontSize: fontSize.caption,
    color: color.textMuted,
    marginTop: spacing.xs,
  },
  deviceId: {
    fontSize: fontSize.body,
    color: color.textSecondary,
  },
  offlineBanner: {
    backgroundColor: color.warningBg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  offlineBannerText: {
    fontSize: fontSize.caption,
    color: color.warning,
  },
  errorBanner: {
    backgroundColor: color.dangerBg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  errorBannerText: {
    fontSize: fontSize.caption,
    color: color.danger,
  },
  sectionTitle: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    color: color.textSecondary,
    marginTop: spacing.xs,
    textTransform: "none",
    letterSpacing: 0.3,
  },
  sessionRow: {
    backgroundColor: color.card,
    borderRadius: radius.lg,
    padding: spacing.lg - 2,
    gap: 4,
    borderWidth: 1,
    borderColor: color.border,
  },
  sessionRowPressed: {
    backgroundColor: brand.cream,
    borderColor: brand.primaryLight,
  },
  sessionRowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  sessionTitle: {
    flexShrink: 1,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
    color: color.textPrimary,
  },
  runningBadge: {
    backgroundColor: brand.creamDeep,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  runningBadgeText: {
    fontSize: 11,
    color: brand.primaryDark,
    fontWeight: fontWeight.bold,
  },
  sessionTime: {
    fontSize: fontSize.caption,
    color: color.textMuted,
  },
  emptyBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 56,
    gap: spacing.md,
  },
  emptyText: {
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.medium,
    color: color.textSecondary,
    marginTop: spacing.sm,
  },
  emptySubText: {
    fontSize: fontSize.body,
    color: color.textMuted,
    textAlign: "center",
    paddingHorizontal: spacing.xxl,
  },
  secondaryButton: {
    borderWidth: 1.5,
    borderColor: brand.primary,
    borderRadius: radius.md,
    alignItems: "center",
    paddingVertical: 11,
    backgroundColor: "#FFFFFF",
    marginTop: spacing.sm,
  },
  buttonPressed: {
    backgroundColor: brand.cream,
  },
  secondaryButtonText: {
    color: brand.primary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
  },
  errorText: {
    fontSize: fontSize.body,
    color: color.danger,
    textAlign: "center",
  },
  plusButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: brand.creamDeep,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  plusPressed: { backgroundColor: brand.primaryLight },
  plusText: {
    fontSize: 20,
    lineHeight: 24,
    color: brand.primaryDark,
    fontWeight: fontWeight.bold,
  },
});
