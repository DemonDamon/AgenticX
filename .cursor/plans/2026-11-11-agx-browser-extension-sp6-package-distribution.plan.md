# SP6 · 打包与分发收尾

归属：feat/agx-browser-extension · Master Plan 第 4 节 Phase 1 尾
依赖：SP3 + SP4 + SP5 全部完成；**且待拍板决策 #2（分发主路径）已有结论**
闭环定义：manifest 定稿、构建产物可用、按选定分发路径完成首次交付动作

## 0. 防扩散边界

- 不新增功能。本 SP 只做工程化：构建、打包、权限定稿、提交流程
- 不做 Firefox/Safari 适配（P2）
- 不做自动更新服务器

## 1. 任务

### 1.1 构建工程化
- 扩展构建脚本（esbuild 或 vite，选 desktop 生态已有的工具链）：`extension/` 产 dist
- desktop 安装器（electron-builder afterInstall hook）：
  - 自动写入 NM host manifest（替换 SP1 的手动注册，路径改为安装产物内 shim）
  - Windows：注册表 HKCU\Software\Google\Chrome\NativeMessagingHosts（SP1 留的 TODO 在此偿还）

### 1.2 分发路径 A：商店（若决策 #2 = 商店优先）
- 权限定稿复查：无 `<all_urls>` 常驻、`debugger` 保持 optional、权限用途说明逐条写
- Chrome Web Store + Edge Add-ons 提审材料（截图、描述、隐私声明：声明数据全部本地处理）

### 1.3 分发路径 B：企业私发（若决策 #2 = 企业私发优先）
- CRX3 打包 + 自建 update manifest（企业内网可托管）
- 输出 `ExtensionInstallForcelist` 策略配置模板 + 私有化部署文档段落
- 内置 deny 域名清单改为企业可下发配置（读取私有化 gateway 配置）

### 1.4 回归
- SP1-SP5 验收清单全量重跑一遍（打包产物环境，非开发模式）
- 特别是：NM host path 在安装环境下生效（spike 的绝对路径 → 安装相对路径）

## 2. 验收判据

1. 全新机器（无开发模式）：装 desktop → 装扩展 → 六 action + 划词注入全通
2. 按选定路径完成首次交付（商店提交回执 / 企业内网安装手册演练）
3. desktop 全部测试绿

## 3. Sub agent 执行提示

- 先读：SP1 的 NM host 注册实现（要改造成安装器逻辑）、决策 #2 结论
- 若决策 #2 未拍板，本 SP 不开工

## 5. 执行结果

> 双路径执行（决策变更：商店 + 企业私发**都**做，1.2 与 1.3 全量交付）。
> 防扩散遵守：纯工程化，未加新功能、未做 Firefox/Safari、未做自动更新服务器。

### 5.1 截图权限姿势矛盾——选型结论（USER-JOURNEYS 执行备注 #2 定稿）

**采纳方案：`optional_host_permissions: <all_urls>` 动态申请（用户在选项页一次性授权）。**

- **为什么不选 activeTab**：`captureVisibleTab` 在 activeTab 激活时确实可用，但 activeTab 只在用户手势
  （点扩展 UI / 右键菜单）时激活；`near_browser_screenshot` 是 agent 经 bridge HTTP 下发的指令，**无用户手势**，
  activeTab 永远拿不到 → agent 截图（六 action 之一、产品核心能力）必挂。activeTab 无法覆盖主场景。
- **生产姿态**：manifest 保持无常驻 `host_permissions`（SP1-SP5 姿势不变，商店审核友好）；选项页新增
  「浏览器截图权限」区块：`chrome.permissions.request({origins:["<all_urls>"]})` 申请 / `remove` 撤销，
  与 SP5 划词注入的按站点授权同一范式。授权后 captureVisibleTab 全站可用（含无手势的 agent 路径）。
- **executor 侧**（extension/src/executor/screenshot.js）：截图前预检 `permissions.contains`
  （`<all_urls>` 或该 tab origin 的可选授权）；无授权时仍尝试一次（兜底 activeTab 刚激活的边缘场景），
  失败返回 `screenshot_permission_required` + 中文引导（不静默失败、不抛 Chrome 原始异常）。
- **e2e 姿势不变**：自动化副本仍 patch 常驻 `host_permissions=["<all_urls>"]`（模拟用户已授权的安装态），
  该机制未受影响，35/35 全绿。
- **SW 冷启动窗口姿势（执行备注 #1）**：维持 SP3 现状（connect 仅在事件驱动时触发），本 SP 未改动。

### 5.2 产出物清单

**本地开发安装（当前试用主路径）**
- `scripts/install-extension-dev.sh`：注册 NM host（wrapper `~/.agenticx/agx-nm-bridge-host.sh` =
  `exec <node> <repo>/scripts/nm-bridge-shim.mjs`；manifest 写入 Chrome/Edge/Chromium/Brave 的
  NativeMessagingHosts 目录，`--browser` 可选）+ shim 帧协议自测（socket 被占用时自动跳过，不打扰运行中的
  bridge）+ 打印 chrome://extensions 开发者模式加载步骤。**本机真实验证通过**：安装 → 自测 7 项 PASS →
  Chrome 式拉起 wrapper 的 NM 帧往返 PASS → 卸载 4 文件清理 → 重装恢复。
- `scripts/uninstall-extension-dev.sh`：全浏览器清理（含 Windows 残留 .cmd/nm-hosts）。

**NM host 安装器工程化**
- `desktop/electron/native-messaging-host.ts`：dev（repo shim + 系统 node）/ installed
  （打包内 `Resources/extension-host/nm-bridge-shim.mjs` + `ELECTRON_RUN_AS_NODE=1` 复用桌面端二进制，
  终端用户无 Node 依赖）双模式；**Windows 注册表逻辑偿还**（HKCU\...\NativeMessagingHosts 默认值 =
  manifest 路径 + .cmd wrapper；reg 命令构造单测逐字断言；mac 上无法运行验证——如实标注，首发前需
  Windows 冒烟）。
- `desktop/scripts/pack-nm-host.js`（electron-builder afterPack 钩子，electron-builder.yml 已接）：
  把 shim 打进产物 Resources。
- `desktop/electron/main.ts`：桌面端启动时幂等 `installNmHost({mode: app.isPackaged ? "installed" : "dev"})`，
  与 install-extension-dev.sh 写同一组文件、内容一致，互不冲突。

**构建产物（双路径）**
- `scripts/build-extension.mjs`：
  - 商店 zip：`extension/dist/agx-bridge-0.1.0.zip`（manifest 在根、排 pem/dist，CWS 上传格式）；
  - 企业 CRX3：`extension/dist/agx-bridge-0.1.0.crx` —— 手写 CrxFileHeader protobuf
    （field 2 = sha256_with_rsa proof、field 10000 = SignedData{crx_id 16B}）+
    RSASSA-PKCS1-v1_5-SHA256 over `"CRX3 SignedData\0"+LE32+data+archive`。**与 Chrome
    --pack-extension 参考产物交叉验证通过**（同 key 同 ID；同一套解析+验签逻辑能验 Chrome 官方签名）。
    注意：crx3.proto 注释里的 "PSS" 是陈旧的，实际是 PKCS1 v1.5（已实测确认）；
  - update manifest 模板：`extension/dist/updates.xml`（appid = 固定 ID，codebase 占位）。
- manifest 定稿为正式分发态：name "AGX Bridge"、version 0.1.0、中文 description（`key` 保留锁定 ID，
  e2e/企业路径 ID 不变）。

**双路径材料**
- 商店：`docs/guides/browser-extension/store-listing-zh.md`（中文描述、9 项权限逐条用途、隐私声明
  「数据全部本地处理、不上传第三方」、商店重新分配 ID 后的 NM 注册跟进流程）；
- 企业：`docs/guides/browser-extension/enterprise-deployment.md`（Forcelist macOS/Windows/Edge 三平台
  模板、私有化托管 updates.xml 说明、NM 注册自动完成说明、冒烟清单）。
- **企业 deny 下发**（保持最小实现）：desktop 读 `~/.agenticx/config.yaml` 的
  `enterprise.browser_deny_domains: [...]`，经 NM 心跳 pong 帧附带推给扩展（≤1 分钟同步、支持删除传播、
  无需重启）；扩展存 `agx_enterprise_deny`，verdict 中**企业清单优先且不可被用户选项页放行**；
  选项页展示下发条数。bridge 未启动时扩展按最近一次同步的清单执行。

### 5.3 回归结果

- `scripts/e2e/verify-user-journey.mjs`：**35/35 PASS**（J1 4/4、J2 6/6、J3 4/4、J4 8/8、J5 8/8、J6 5/5）。
- desktop vitest：新增 22 测试全绿（native-messaging-host 12 + enterprise-deny-distribution 10）；
  全量 19 个失败为**存量**（干净 HEAD 4fe4b31a2 上逐一同数失败：HarnessPicker/InlineImageBlock/
  ProviderIcon/session-continue + playwright e2e spec 收集失败，均与本 SP 改动无关——已用 HEAD worktree
  对比验证）。
- `tsc -p electron/tsconfig.json --noEmit`：exit 0。根 tsconfig（渲染器 src/）157 个存量错误未触碰。
- 测试隔离事故修复：native-messaging-host.test.ts 初版 `vi.spyOn(os,"homedir")` + `mockRestore()` 在
  vitest 4 下 restore 后 spy 脱钩、后续 mockReturnValue 静默失效，导致用例写进真实 home（已修复为不
  restore + 备注根因；本机 NM 注册已通过 install-extension-dev.sh 重装恢复）。

### 5.4 遗留（如实标注）

- Windows 注册表执行 / CRX3 的 Forcelist 真机安装：mac 开发机上无法运行验证，均已完成命令级/产物级
  交叉验证并在文档中标注「首发前 Windows 试点冒烟」；
- 商店正式 ID 拿到后需更新 `installNmHost` 的 extensionId 默认值并随桌面端发版（材料文档已写流程）；
- 生产私钥替换：`extension/test-extension-key.pem` 为开发 key，企业生产需换自有 key 并同步 manifest `key`
  （企业文档第 0 节已写步骤）。
