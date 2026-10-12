import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { getBinding } from "../src/store";

/**
 * 入口页：读本地绑定态做分发。
 * 无 gateway_base / mobile_token → pair；有 → sessions。
 */
export default function Index() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const binding = await getBinding();
        if (cancelled) return;
        if (binding !== null) {
          router.replace("/sessions");
        } else {
          router.replace("/pair");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.container}>
      {error === null ? (
        <ActivityIndicator size="large" />
      ) : (
        <Text style={styles.errorText}>初始化失败：{error}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    color: "#B3261E",
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: 24,
  },
});
