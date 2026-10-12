import { withAndroidManifest, type ConfigPlugin } from "expo/config-plugins";

/**
 * 真机联调必需：允许 Android 明文 HTTP。
 *
 * RN gradle 插件默认 release 构建 usesCleartextTraffic=false（debug 为 true），
 * 局域网网关（http://192.168.x.x:port）的 fetch 会被系统直接拦截，
 * 扫码后表现为「无法连接网关」。Near Mobile 为内部分发、网关走内网，
 * 全局放行明文可接受；若日后网关强制 HTTPS 可移除本插件。
 */
const withUsesCleartextTraffic: ConfigPlugin = (config) => {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (application) {
      application.$ = {
        ...application.$,
        "android:usesCleartextTraffic": "true",
      };
    }
    return config;
  });
};

export default withUsesCleartextTraffic;
