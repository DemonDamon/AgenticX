import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Near Mobile",
  slug: "nearx-mobile",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  // SDK 57：原生启动屏配置需 expo-splash-screen 包（本 SP 不引入新依赖）。
  // assets/splash-icon.png 已备好，后续迭代装插件后在此加 plugin 配置即可启用。
  scheme: "nearx",
  userInterfaceStyle: "light",
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.nearx.mobile",
    // 真机联调必需：ATS 默认禁止非 localhost 的明文 HTTP，
    // NSAllowsLocalNetworking 放行局域网地址（192.168.x.x 等），不影响公网 HTTPS。
    infoPlist: {
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    },
  },
  android: {
    package: "com.nearx.mobile",
    adaptiveIcon: {
      backgroundColor: "#FFF7F0",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: "./assets/favicon.png",
    bundler: "metro",
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    // 真机联调必需：Android release 构建默认禁止明文 HTTP，局域网网关会被拦
    "./plugins/with-uses-cleartext-traffic",
    [
      "expo-camera",
      {
        cameraPermission: "允许 Near 访问相机，用于扫描桌面端配对二维码。",
      },
    ],
    "expo-status-bar",
  ],
};

export default config;
