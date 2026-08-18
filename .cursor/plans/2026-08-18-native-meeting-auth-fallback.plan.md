# 腾讯会议连接器授权兜底与 CLI 升级

Planned-with: gpt5.6sol

## 目标

仅在 `hc-0818` 交付分支修复腾讯会议扫码授权被系统浏览器或代理故障卡住的问题，并将内置腾讯会议官方 CLI 从 1.0.11 升级到 1.0.15。用户即使无法在电脑浏览器打开授权页，也能在不终止 CLI 授权会话的前提下使用手机扫码、复制链接或重新打开网页。

## 根因与证据

- 腾讯会议 CLI 会输出形如 `https://meeting.tencent.com/marketplace/tencentmeeting-cli-auth.html?code=<一次性代码>` 的授权地址。
- `desktop/electron/main.ts` 的 `startTmeetLogin()` 当前在 `shell.openExternal()` 失败时立即调用 `finish(..., true)`，终止 CLI 进程，因此 renderer 没有机会展示同一个一次性授权地址。
- 客户截图中的 `ERR_TUNNEL_CONNECTION_FAILED` 属于浏览器代理隧道错误；URL 本身通过腾讯会议域名校验，且不能靠更换静态网址绕过一次性授权流程。
- 当前安装常量锁定 1.0.11；已对 1.0.15 npm 包及五个平台二进制重新计算 SHA-512/SHA-256。

## 范围

### In scope

- `desktop/electron/main.ts`
  - 更新 `TMEET_PACKAGE_VERSION`、tarball 地址、包 SHA-512 与平台二进制 SHA-256。
  - 扩展 `sendTmeetProgress()`，仅把已经过 `extractAuthorizationUrl()` 域名白名单校验的授权地址发给 renderer。
  - `shell.openExternal()` 失败时保持 CLI 进程和 5 分钟授权窗口存活，通过进度事件标记 `browserOpenFailed`。
- `desktop/electron/preload.ts`、`desktop/src/global.d.ts`
  - 为腾讯会议进度事件增加可选 `authorizationUrl`、`browserOpenFailed` 字段。
- `desktop/src/components/connectors/TencentMeetingAuthFallback.tsx`
  - 本地生成二维码；提供“重新打开网页”和“复制链接”；不持久化一次性地址。
- `desktop/src/components/settings/connectors/ConnectorsTab.tsx`
  - 设置页授权弹窗接收并展示兜底；成功、失败、取消和断开时清理一次性地址。
- `desktop/src/components/connectors/ConnectorsMenuButton.tsx`
  - 对话输入区的连接器入口复用同一兜底组件，并保持取消可用。
- `desktop/tests/native-connectors-core.test.ts`、`desktop/tests/tmeet-connector-fallback.test.ts`
  - 覆盖当前授权 URL 格式、版本/完整性常量、进程不中断契约及双入口接线。

### Out of scope

- 不修改腾讯会议网页、代理或企业网络配置。
- 不修改通用浏览器代理策略、其他连接器协议或凭证存储方式。
- 不改动其他分支，不夹带工作区已有未提交文件。

## 实施细节

### FR-1：升级并校验 CLI 1.0.15

Suggested-Impl-Model: gpt5.6sol

锚点：`desktop/electron/main.ts` 中 `TMEET_PACKAGE_VERSION` 与 `tmeetBinarySha256()`。

- tarball：`https://registry.npmjs.org/@tencentcloud/tmeet/-/tmeet-1.0.15.tgz`
- SHA-512：`lMvcaNgEujhYk7RNakghdyjk5VukEeHrJOlpTenNhyiNuBcCEa9XtW8pYMQQDcxltAQpT9omGogkaXXAakN10w==`
- Linux ARM64：`789cf1643957c5e6e4cccfcc6e60fdb237fb2c94222316a3a4c2dd05ebdd8bd9`
- Linux x64：`ef76a60fe2dc630b3b87c1e2e8c0f46b5e065c69dc9441f67d0bdb916116084f`
- Windows x64：`755ca8d8328a9217b2e3c681b2bf9204b4a725079a1a0339e62eea0c984348e8`
- macOS Apple Silicon：`f245226550cda8e1ea8b6e6bafbead2fb91e6e823b52905f5bb1cae485ec3914`
- macOS Intel：`f0f954345fca981f8834f2e6d7fa2329e87960ce068310dcabbdd42642b3e71a`

AC：测试能读取并断言版本、包地址和完整性常量；Desktop Electron TypeScript 编译通过。

### FR-2：系统浏览器失败不终止授权

Suggested-Impl-Model: gpt5.6sol

锚点：`startTmeetLogin()` 内 `consume()` 的 `shell.openExternal(authorizationUrl)` 链。

Before：打开浏览器失败后 `finish({ error: ... }, true)`，CLI 被 `SIGTERM`。

After：

```ts
sendTmeetProgress("opening_browser", { authorizationUrl });
void shell.openExternal(authorizationUrl)
  .then(() => sendTmeetProgress("waiting", { authorizationUrl }))
  .catch(() => sendTmeetProgress("waiting", {
    authorizationUrl,
    browserOpenFailed: true,
  }));
```

AC：源码契约测试确认 catch 分支不调用 `finish()`；取消、超时、CLI 退出仍沿用现有收口逻辑。

### FR-3：双入口展示可操作兜底

Suggested-Impl-Model: gpt5.6sol

锚点：`ConnectorsTab` 腾讯会议 Modal 与 `ConnectorsMenuButton` 返回区。

- 进度事件带 URL 后即时生成约 200px 二维码。
- 用户可复制链接或重新调用既有 `openExternal` IPC；操作失败显示就地错误但不取消 CLI。
- 对话入口使用独立 Modal，关闭/取消调用 `nativeConnectorTmeetCancel()`，不出现无法退出的遮罩。
- 终态和重新发起连接前清理 URL、二维码与错误状态，避免旧一次性代码残留。

AC：设置页和对话入口均引用统一组件；取消测试继续通过；renderer 类型检查和 Vite 构建通过。

## 验证命令

```text
cd desktop
npx vitest run tests/native-connectors-core.test.ts tests/tmeet-connector-cancel.test.ts tests/tmeet-connector-fallback.test.ts
npm run build
```

## 提交边界

只暂存本计划及上述腾讯会议相关文件；提交留在 `hc-0818`，不推送，除非用户另行要求。
