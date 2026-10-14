import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, View } from "react-native";
import { ConfirmCard } from "../src/components/ConfirmCard";
import { useGateway } from "../src/hooks/useGateway";
import { brand, color, fontSize, fontWeight } from "../src/ui/theme";

export default function RootLayout() {
  const { client } = useGateway();
  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: brand.cream },
          headerTitleStyle: {
            color: color.textPrimary,
            fontSize: fontSize.title,
            fontWeight: fontWeight.bold,
          },
          headerTintColor: brand.primary,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: color.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen
          name="pair"
          options={{ headerShown: false, contentStyle: { backgroundColor: brand.cream } }}
        />
        <Stack.Screen name="sessions" options={{ title: "全部任务" }} />
        <Stack.Screen name="sessions/[id]" options={{ title: "会话" }} />
        <Stack.Screen name="settings" options={{ title: "绑定与设置" }} />
      </Stack>
      <ConfirmCard client={client} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.bg,
  },
});
