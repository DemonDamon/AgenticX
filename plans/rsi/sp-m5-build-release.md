# SP-M5 — 打包发布：EAS + Android 自签 APK + iOS TestFlight

## 背景与动机

功能完成后进入分发。决策已定（见 master plan）：Android 自签 APK 直发（零审核），
iOS 走 TestFlight（复用 DMG 的 Apple Developer 账号，新增 iOS Distribution 证书
+ App ID `com.near.mobile`，不新增年费）。

## 方案

### EAS 配置（mobile/eas.json）

```json
{
  "cli": { "version": "latest", "appVersionSource": "remote" },
  "build": {
    "preview": { "android": { "buildType": "apk" }, "distribution": "internal" },
    "production": { "autoIncrement": true }
  },
  "submit": { "production": { "ios": { "ascAppId": "<占位，用户 Apple 账号定>" } } }
}
```

### Android

- `scripts/gen-keystore.sh`：`keytool -genkeypair` 生成 keystore +
  使用说明（密码托管方式：EAS secrets 或本地 `keystore.properties`，gitignore）
- `eas build -p android --profile preview` → APK 直发（官网/群文件）
- keystore 丢失 = 无法续发更新，脚本输出首行即备份警告

### iOS

- 前置（需用户 Apple 账号操作，文档列出）：App Store Connect 建 App、
  注册 App ID、iOS Distribution 证书
- `eas build -p ios --profile production` + `eas submit` → TestFlight 内测
- 文档写清 Ad Hoc 备选路径（100 台/年 UDID 模式，无审核焦虑）

### 交付物

- `mobile/eas.json` + `mobile/scripts/gen-keystore.sh` + `mobile/RELEASE.md`
  （双端发布 runbook：从零到可安装，含用户需亲手做的账号步骤清单）
- app icon + splash（Expo 配置，简单品牌图即可，不阻塞）

## 验收标准

- `eas build --profile preview -p android` 可出 APK（或本地 `expo run` 产物），
  真机安装可跑通 SP-M4 全路径
- iOS 侧：配置就绪 + runbook 可执行（实际出包依赖用户 Apple 账号，
  本 SP 交付到「文档级 + 配置级完成」）
- 提交 AgenticX main

## 非目标

- 上架 Google Play / 国内应用商店（企业软著等另行立项）
- OTA（EAS Update）策略——上线稳定后再启用
