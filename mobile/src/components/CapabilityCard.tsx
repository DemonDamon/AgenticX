import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { GatewayClient } from "../api/client";
import type { McpServerInfo, ToolRegistryItem } from "../api/types";
import { brand, color, fontSize, fontWeight, radius, spacing } from "../ui/theme";

const MAX_TOOLS = 6;

/** 「Near 会什么」只读卡：技能（工具注册表）+ MCP 连接状态；失败整体隐藏不阻塞输入 */
export function CapabilityCard({ client }: { client: GatewayClient | null }) {
  const [tools, setTools] = useState<ToolRegistryItem[] | null>(null);
  const [mcps, setMcps] = useState<McpServerInfo[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (client === null) return;
    let alive = true;
    void Promise.all([client.getToolsRegistry(), client.getMcpServers()])
      .then(([t, m]) => {
        if (!alive) return;
        setTools(t.tools);
        setMcps(m.servers);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [client]);

  if (failed) return null;
  if (tools === null && mcps === null) {
    return (
      <View style={styles.wrap}>
        <ActivityIndicator size="small" color={brand.primary} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Near 会什么</Text>
      {tools !== null ? (
        <View style={styles.section}>
          {tools.slice(0, MAX_TOOLS).map((t) => (
            <View key={t.name} style={styles.toolRow}>
              <Text style={styles.toolName} numberOfLines={1}>
                {t.name}
              </Text>
              <Text style={styles.toolDesc} numberOfLines={1}>
                {t.description}
              </Text>
            </View>
          ))}
          {tools.length > MAX_TOOLS ? (
            <Text style={styles.moreText}>…等 {tools.length} 项能力</Text>
          ) : null}
        </View>
      ) : null}
      {mcps !== null && mcps.length > 0 ? (
        <View style={styles.section}>
          {mcps.map((m) => (
            <View key={m.name} style={styles.mcpRow}>
              <View
                style={[
                  styles.dot,
                  m.connection_state === "healthy" ? styles.dotOk : styles.dotOff,
                ]}
              />
              <Text style={styles.mcpName} numberOfLines={1}>
                {m.name}
              </Text>
              <Text style={styles.mcpCount}>{m.tool_count} 工具</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: { fontSize: fontSize.body, fontWeight: fontWeight.semibold, color: color.textPrimary },
  section: { gap: spacing.xs + 2 },
  toolRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  toolName: {
    fontSize: fontSize.caption,
    color: brand.primaryDark,
    fontWeight: fontWeight.medium,
    fontFamily: "Menlo",
    flexShrink: 0,
  },
  toolDesc: { fontSize: fontSize.caption, color: color.textMuted, flexShrink: 1 },
  moreText: { fontSize: fontSize.caption, color: color.textMuted },
  mcpRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotOk: { backgroundColor: color.online },
  dotOff: { backgroundColor: color.offline },
  mcpName: { fontSize: fontSize.caption, color: color.textSecondary, flexShrink: 1 },
  mcpCount: { fontSize: fontSize.caption, color: color.textMuted, marginLeft: "auto" },
});
