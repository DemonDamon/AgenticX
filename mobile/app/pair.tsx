import { CameraView, useCameraPermissions } from "expo-camera";
import { openSettings } from "expo-linking";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ApiError, GatewayClient } from "../src/api/client";
import { notifyBindingChanged } from "../src/lib/events";
import { getInstallId, saveBinding } from "../src/store";
import { BrandMark } from "../src/ui/BrandMark";
import { Button } from "../src/ui/Button";
import { brand, color, fontSize, fontWeight, radius, spacing } from "../src/ui/theme";

interface ConnectTarget {
  gatewayBase: string;
  connectSessionId: string;
}

/**
 * 解析配对 URL：`{scheme}://{host}[:port]/connect/{session_id}`
 * gateway base = scheme://host[:port]，connect_session_id = 最后一段。
 */
export function parseConnectUrl(text: string): ConnectTarget | null {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#\s]+)\/connect\/([a-z0-9_-]+)\/?$/i.exec(
    text.trim(),
  );
  if (match === null) return null;
  return {
    gatewayBase: `${match[1]}://${match[2]}`,
    connectSessionId: match[3],
  };
}

/** 扫码取景框四角的品牌橙括号 */
function FinderCorners() {
  const corner = {
    position: "absolute" as const,
    width: 28,
    height: 28,
    borderColor: brand.primary,
    borderWidth: 3,
  };
  return (
    <>
      <View style={[corner, { top: 16, left: 16, borderTopLeftRadius: 6, borderRightWidth: 0, borderBottomWidth: 0 }]} />
      <View style={[corner, { top: 16, right: 16, borderTopRightRadius: 6, borderLeftWidth: 0, borderBottomWidth: 0 }]} />
      <View style={[corner, { bottom: 16, left: 16, borderBottomLeftRadius: 6, borderRightWidth: 0, borderTopWidth: 0 }]} />
      <View style={[corner, { bottom: 16, right: 16, borderBottomRightRadius: 6, borderLeftWidth: 0, borderTopWidth: 0 }]} />
    </>
  );
}

function QrScanner({
  locked,
  onResult,
}: {
  locked: boolean;
  onResult: (data: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();

  if (permission === null) {
    return (
      <View style={styles.scannerBox}>
        <ActivityIndicator size="large" color={brand.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.scannerBox}>
        <Text style={styles.hintText}>
          {permission.canAskAgain
            ? "需要相机权限才能扫码配对。"
            : "相机权限已被拒绝，请到系统设置中开启后返回。"}
        </Text>
        <Button
          title={permission.canAskAgain ? "授权相机" : "去系统设置"}
          variant="secondary"
          onPress={() => {
            if (permission.canAskAgain) {
              void requestPermission();
            } else {
              void openSettings();
            }
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.cameraWrap}>
      <CameraView
        style={styles.camera}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={locked ? undefined : (result) => onResult(result.data)}
      />
      <FinderCorners />
      {locked ? (
        <View style={styles.cameraOverlay}>
          <ActivityIndicator size="large" color="#FFFFFF" />
        </View>
      ) : null}
    </View>
  );
}

export default function PairScreen() {
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(Platform.OS === "web");
  const [manualUrl, setManualUrl] = useState("");

  const handleBind = useCallback(async (target: ConnectTarget) => {
    setBusy(true);
    setMessage(null);
    try {
      const installId = await getInstallId();
      const client = new GatewayClient({
        gatewayBase: target.gatewayBase,
        installId,
      });
      const result = await client.bind(target.connectSessionId);
      await saveBinding({
        gateway_base: target.gatewayBase,
        device_id: result.device_id,
        mobile_token: result.mobile_token,
      });
      // 通知 _layout 等处重建 GatewayClient（启动全局审批轮询）
      notifyBindingChanged();
      router.replace("/sessions");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setMessage("该二维码已绑定其它设备，请先在原设备上解绑后重试。");
        } else if (err.status === 404) {
          setMessage("二维码无效或已过期，请让桌面端重新生成。");
        } else {
          setMessage(`配对失败：${err.detail}`);
        }
      } else {
        setMessage("无法连接网关，请检查手机网络或网关地址是否可达。");
      }
      // 保持 scanned=true 锁定相机，由用户显式「重新扫码」，
      // 避免同一张二维码在镜头里反复自动重试请求。
    } finally {
      setBusy(false);
    }
  }, []);

  const handleScanned = useCallback(
    (data: string) => {
      if (busy) return;
      const target = parseConnectUrl(data);
      if (target === null) {
        setMessage("二维码内容不是有效的配对链接。");
        return;
      }
      setScanned(true);
      void handleBind(target);
    },
    [busy, handleBind],
  );

  const handleManualBind = useCallback(() => {
    if (busy) return;
    const target = parseConnectUrl(manualUrl);
    if (target === null) {
      setMessage("链接格式不正确，应为「https://网关地址/connect/会话ID」。");
      return;
    }
    void handleBind(target);
  }, [busy, manualUrl, handleBind]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.pageContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <BrandMark size={84} plated />
          <Text style={styles.productName}>Near</Text>
          <Text style={styles.tagline}>Near, Always Near.</Text>
        </View>

        <Text style={styles.sectionTitle}>连接你的 Near 桌面端</Text>
        {Platform.OS === "web" ? (
          <View style={styles.scannerBox}>
            <Text style={styles.hintText}>
              Web 端不支持扫码，请粘贴桌面端展示的配对链接。
            </Text>
          </View>
        ) : (
          <QrScanner locked={busy || scanned} onResult={handleScanned} />
        )}
        <Text style={styles.scanHint}>打开桌面端 Near → 设备 → 用手机扫描配对二维码</Text>

        {message !== null ? (
          <View style={styles.messageBox}>
            <Text style={styles.errorText}>{message}</Text>
            {scanned && !busy ? (
              <Button
                title="重新扫码"
                variant="secondary"
                onPress={() => {
                  setScanned(false);
                  setMessage(null);
                }}
              />
            ) : null}
          </View>
        ) : null}

        <Pressable
          style={styles.collapsibleHeader}
          onPress={() => {
            setManualOpen(!manualOpen);
          }}
        >
          <Text style={styles.collapsibleHeaderText}>
            {manualOpen ? "收起手动输入" : "无法扫码？手动输入配对链接"}
          </Text>
        </Pressable>

        {manualOpen ? (
          <View style={styles.manualBox}>
            <TextInput
              style={styles.input}
              placeholder="https://gateway-host/connect/xxxx"
              placeholderTextColor={color.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={manualUrl}
              onChangeText={setManualUrl}
              editable={!busy}
            />
            <Button
              title="绑定桌面端"
              onPress={handleManualBind}
              loading={busy}
              disabled={busy}
            />
          </View>
        ) : null}

        <Text style={styles.footerNote}>Near Mobile · v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: brand.cream,
  },
  page: {
    flex: 1,
  },
  pageContent: {
    padding: spacing.xl,
    paddingTop: spacing.xxl,
    gap: spacing.md,
  },
  hero: {
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  productName: {
    fontSize: fontSize.h1,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
    letterSpacing: 0.5,
    marginTop: spacing.sm,
  },
  tagline: {
    fontSize: fontSize.bodyLg,
    color: brand.primaryDark,
    fontWeight: fontWeight.medium,
    letterSpacing: 0.2,
  },
  sectionTitle: {
    fontSize: fontSize.title,
    fontWeight: fontWeight.semibold,
    color: color.textPrimary,
    marginBottom: spacing.xs,
  },
  cameraWrap: {
    height: 300,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: "#1F1F1F",
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  scannerBox: {
    minHeight: 180,
    borderRadius: radius.lg,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: color.border,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
  scanHint: {
    fontSize: fontSize.caption,
    color: color.textSecondary,
    textAlign: "center",
  },
  hintText: {
    fontSize: fontSize.body,
    color: color.textSecondary,
    textAlign: "center",
  },
  errorText: {
    fontSize: fontSize.body,
    color: color.danger,
    textAlign: "center",
  },
  messageBox: {
    gap: spacing.sm,
    backgroundColor: color.dangerBg,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  collapsibleHeader: {
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  collapsibleHeaderText: {
    fontSize: fontSize.body,
    color: brand.primary,
    fontWeight: fontWeight.medium,
  },
  manualBox: {
    gap: spacing.md,
  },
  input: {
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: fontSize.bodyLg,
    color: color.textPrimary,
  },
  footerNote: {
    fontSize: fontSize.caption,
    color: color.textMuted,
    textAlign: "center",
    marginTop: spacing.lg,
  },
});
