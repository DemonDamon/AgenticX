# Near Mobile 发布 Runbook（EAS + Android 自签 APK + iOS TestFlight）

从零到可安装的完整步骤。双端均通过 EAS 云端构建，本机不需要 Android Studio / Xcode。
（本地跑 `expo run:android` 才需要本地工具链，云构建用不上。）

## 0. 前置条件

| 依赖 | 要求 | 检查命令 |
|---|---|---|
| Node | ≥ 18 | `node -v` |
| EAS CLI | 任意近期版本 | `npx eas-cli --version`（免全局安装；惯用者可 `npm i -g eas-cli`） |
| EAS 账号 | expo.dev 免费账号即可 | — |
| JDK（仅生成 keystore 需要） | 17+ | `brew install openjdk@17` |

```bash
cd mobile
npx eas-cli login      # 浏览器跳转登录 expo.dev 账号
npx eas-cli whoami     # 确认已登录
```

首次在 mobile/ 目录跑 eas 命令时会询问关联的 Expo 账号与项目名，按提示创建即可
（项目 slug 为 `nearx-mobile`）。

## 1. Android：自签 APK 直发（零审核）

### 1.1 生成上传密钥（一次性的，永久有效）

```bash
./scripts/gen-keystore.sh
```

- 默认产出 `mobile/android-upload.keystore`（已被 .gitignore 排除，不会入库）
- 密码交互输入，不落 shell 历史
- ⚠️ **立即备份**：keystore + 密码存进密码管理器 / 离线存储。**丢失 = 已发布的 APK
  永远无法再更新**（只能换 applicationId 重新发布，用户需卸载重装）

### 1.2 构建 APK

```bash
npx eas-cli build -p android --profile preview
```

- `preview` profile：`distribution: internal` + `buildType: apk`（见 eas.json）
- 首次构建 EAS 会询问签名方式：选 **「Upload a keystore」**，把上一步生成的
  `android-upload.keystore` 连同密码上传（之后 EAS 云端托管，换电脑不用重传）
- 构建完成后得到一个 .apk 下载链接，直接发给用户即可（群文件 / 官网 / 网盘）

### 1.3 用户安装提示（internal distribution）

APK 不是应用商店分发，Android 会拦一次：

- Android 8+：安装时弹「不允许安装未知应用」→ 引导用户到
  「设置 → 应用 → 特殊权限 → 安装未知应用」里对浏览器/文件管理器开启
- 部分国产 ROM（小米/华为等）有额外的「纯净模式」或风险提示，点继续安装即可
- 首次安装后升级：直接安装同签名的新 APK 覆盖，无需卸载

## 2. iOS：TestFlight 内测

iOS 无法像 Android 那样直发安装包，两条路：TestFlight（推荐，最多 10000 内测）
和 Ad Hoc（备选，100 台/年）。都需要付费 Apple Developer 账号（$99/年）。

> **账号说明**：打包 macOS DMG 用的 Developer ID Application 证书，与这里需要的
> **iOS Distribution 证书，是同一 Apple Developer 账号下两种不同用途的证书，互不通用**。
> 账号不用新注册，但在 Apple 后台需要单独创建 iOS 证书和 App ID。

### 2.1 需要你亲手做的（一次性，约 15 分钟）

1. **注册 App ID**：Apple Developer 后台 → Certificates, Identifiers & Profiles →
   Identifiers → 注册 `com.nearx.mobile`（Bundle ID 与 app.config.ts 的
   `ios.bundleIdentifier` 一致）
2. **创建 iOS Distribution 证书**：同一页面 Certificates → 新建
   `Apple Distribution` 类型（在 Mac 钥匙串里生成 CSR → 上传 → 下载 .cer）
3. **App Store Connect 建 App**：appstoreconnect.apple.com → 我的 App → 新建，
   Bundle ID 选 `com.nearx.mobile`，名称随意（如 "Near"）
4. **记录 App ID 数字**：App Store Connect → App 信息 → 「Apple ID」一栏的纯数字
   （如 `1234567890`），填到 `mobile/eas.json` 的
   `submit.production.ios.ascAppId`（当前是 `<TODO: Apple 账号创建后填>` 占位）
5. **EAS credentials**：首次 iOS 构建时 EAS 会引导生成/上传证书与描述文件，
   全程交互式，按提示走「Let EAS manage credentials」最省事

### 2.2 构建并提交

```bash
npx eas-cli build -p ios --profile production
npx eas-cli submit -p ios --profile production     # 需先填好 ascAppId
```

- `production` profile 默认 store 分发 + `autoIncrement: true`（build 号自增）
- submit 之后到 App Store Connect → TestFlight，等处理完成（几分钟到半小时）
- TestFlight 页面添加内部测试员（最多 100 人，即时可用）或外部测试员
  （最多 10000 人，首次需简易 Beta 审核）

### 2.3 Ad Hoc 备选（100 台/年，无任何审核）

不想碰 TestFlight 审核、设备数量少时可用：

```bash
npx eas-cli build -p ios --profile preview
```

`preview` profile 的 `distribution: internal` 对 iOS 即 Ad Hoc 包。需要先在
Apple 后台把测试设备的 UDID 注册进 profile（EAS 构建时可以用
`npx eas-cli device:create` 生成登记链接，让测试者用 Safari 打开自动采集 UDID）。
产出 .ipa 通过 `npx eas-cli build:list` 拿下载链接，配合
Apple Configurator / AltStore 安装。

## 3. 常见坑

- **Android 上架 Google Play 才需要 AAB + Play App Signing**。v1 直发 APK 用不上，
  不要在上传 keystore 时被「让 Google 管理签名」的选项带偏——那是上架流程的事。
- **keystore 泄漏**：他人可冒充你的应用签名发假包。应对：立即停用该签名
  （无法远程吊销 APK 签名），换新 keystore + 新 applicationId 重新发布，并通知
  用户卸载旧版。预防：keystore 永远不进 git（.gitignore 已排除）、不进聊天记录。
- **iOS 证书配额**：一个账号最多 2 个 Apple Distribution 证书、100 个 App ID /
  注册设备，超了要先删旧的。
- **版本号**：`appVersionSource: "remote"`，EAS 云端管理 versionCode/buildNumber，
  本地 app.config.ts 只管 `version`（语义版本）。
- **OTA（EAS Update）未启用**：当前每次发版都是完整构建包，热修复能力待后续迭代。

## 4. 版本升级发布清单

1. 改 `app.config.ts` 的 `version`
2. Android：重复 1.2（autoIncrement 自增 versionCode）
3. iOS：重复 2.2（autoIncrement 自增 buildNumber）
4. 验证真机：扫码配对 → 会话列表 → 发指令 → 审批卡 全路径
