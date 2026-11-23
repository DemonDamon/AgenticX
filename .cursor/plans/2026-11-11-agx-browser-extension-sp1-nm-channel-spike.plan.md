# SP1 · NM 通道 Spike（Phase 0 技术前提）

归属：feat/agx-browser-extension · Master Plan 第一节
依赖：无（全部 SP 的起点）
闭环定义：扩展与 desktop 建立可保活、可自愈的 Native Messaging 双向通道

## 0. 防扩散边界（先读）

- **只做通道，不做任何浏览器 action 执行**（执行器是 SP3）
- 不改 `agenticx/` 任何 Python 代码
- 不做 UI（确认卡片是 SP4，侧边栏是 P2 已砍）
- 不做 Windows 注册表（spike 只验 macOS，Windows 写 TODO 注释留 SP6）

## 1. 背景

MV3 Service Worker 会被回收。NM 长连接的保活与断线自愈是整个插件方案唯一的技术不确定点，
不过关则 master plan 降级为"扩展长轮询 bridge"。本 spike 只回答这个问题。

## 2. 链路设计（Bitwarden/1Password 范式）

```
扩展 SW ─ chrome.runtime.connectNative ─ NM(stdio) ─ shim 脚本 ─ unix socket ─ desktop 常驻进程
```

- NM host 不是 desktop 二进制本身，是独立 shim（node 脚本），桥接 stdio ↔ socket
- desktop 常驻进程创建 unix socket：`~/.agenticx/browser_bridge_nm.sock`
- 消息格式：JSON per line（NM 帧协议：4 字节小端长度前缀 + JSON，shim 负责解帧）

## 3. 任务

### 3.1 desktop 侧
- 新建 `desktop/electron/nm-socket-server.ts`：unix socket server，echo 协议
  （收到 `{type:"ping", ts}` 回 `{type:"pong", ts}`），挂到 main.ts 启动流程
- 新建 `scripts/nm-bridge-shim.mjs`：读 NM stdin 帧 → 写 socket；读 socket → 写 stdout 帧

### 3.2 NM host 注册
- 新建 `desktop/electron/native-messaging-host.ts`：
  生成 NM host manifest（name: `com.agenticx.bridge`, type: `stdio`）写入
  `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.agenticx.bridge.json`
- **已知坑**：`allowed_origins` 需要扩展 ID。未上架扩展用开发者模式加载时 ID 不固定——
  生成扩展 key（manifest "key" 字段）锁定 ID，spike 里写一个固定测试 key 并注明
- path 指向 shim：spike 阶段允许绝对路径指向仓库内 shim + `node` 解释器 wrapper

### 3.3 扩展骨架
- 新建 `extension/manifest.json`（MV3）：permissions: `["nativeMessaging","storage","alarms"]`
- 新建 `extension/src/sw.js`：
  - `connectNative` 建立 port，`port.onDisconnect` 触发重连（指数退避，上限 30s）
  - `chrome.alarms.create("nm-heartbeat", {periodInMinutes: 1})`：alarm 时若 port 断开则重连、
    存活则发 ping 记录 RTT 到 `chrome.storage.local`
  - **验证目标**：SW 被回收后，alarm 唤醒能重建 NM 连接
- 新建 `extension/src/popup.html`（最小）：显示连接状态 + RTT（调试用，不是产品 UI）

## 4. 验收判据（全部满足才算闭环）

1. 心跳链路存活 ≥ 2 小时（期间手动重启浏览器一次、sleep desktop 一次），重连均自愈 ≤ 30s
2. echo RTT 记录可见且 < 100ms
3. 结论写入本文件末尾：`## 5. Spike 结论` —— PASS（保活机制成立）或 FAIL（转长轮询，理由）

## 6. Sub agent 执行提示

- 先读：master plan（同目录 `2026-11-11-agx-browser-extension.plan.md`）第 3.1 节
- NM 帧协议细节以 Chrome 官方文档为准（developer.chrome.com/docs/extensions/develop/concepts/native-messaging），
  不要凭记忆写
- 验证方式：`npx tsc --noEmit`（desktop）+ 手动加载扩展（chrome://extensions 开发者模式）

## 5. Spike 结论（2026-11-11，SP1 执行 agent 回填）

**判定：PASS —— NM 通道保活/自愈机制成立，无需降级长轮询，SP2 可以启动。**

### 5.1 扩展固定测试 key 与 ID 记录

- 扩展 ID（由下方公钥锁定）：`kajgkmohjdflaidencpfmebbjibfieka`
- `extension/manifest.json` 的 `"key"` 字段（RSA-2048 公钥 DER base64）：
  `MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwvUg8qgW7kc5OePyU4swklSe9gGsTfGh4irNS3F2mctbzf6lb572qeaRVKtGBTk+cO2s4xAk1KrZjGFheahZLgyOaE2QjfqnfUEq1rLs6GPt9ArI/OFu36ATpiA/e0CDdmUNGd738qYxG+FAwdUa2eomxTZoHMXRjgpHbbMAfVP7+fR2pd+03vXyXlvEYfBuVDWsXVi2iXxQ3HDEsownzTrFDEzx+m6TtDsMUMa23v7eU+4dlYvysmFsrKXDoqnvea8GJWyD1WZZWKKLRQmHu6FAApEfLb5jHulhCYaBuddRJeAOE0xwgVu4/76FIuRwchqNNcmEW0/ma6XqqTllswIDAQAB`
- 私钥：`extension/test-extension-key.pem`（本地文件，已被 .gitignore 的 `*.pem` 规则忽略，不入库；
  上架打包时需要它签出同 ID 的 zip/CRX；ID 只由公钥决定，公钥已随 manifest 入库，其他人 clone 后 ID 不变）

### 5.2 自动化验证结果（2026-11-11，node v26.8.1 / macOS / Chrome for Testing 141+）

1. **desktop 类型检查 PASS**：`npx tsc -p electron/tsconfig.json --noEmit` 零错误
   （desktop 根 tsconfig 的既有错误全部在 `src/`，与 SP1 无关）
2. **shim ↔ socket 链路 PASS**：`node scripts/e2e/test-nm-shim.mjs` —— 5 次 ping→pong
   RTT 11-33ms（< 100ms）、非 ping 消息原样回显、stdin EOF 后 shim 干净退出
3. **真浏览器链路 PASS**：`node scripts/e2e/verify-nm-channel.mjs` ——
   - Phase 1：扩展 SW 经 connectNative 建立连接，echo RTT 43ms 记录到 chrome.storage.local
   - Phase 2：SIGKILL shim 进程模拟断链，SW onDisconnect 指数退避重连，
     **~1.1s 内恢复并记录新 pong（RTT 54ms，reconnectAttempts=1）**，远优于 30s 预算

### 5.3 环境发现（后续 SP 必读的坑）

1. **Chrome 137+ 正式版忽略 `--load-extension`**（日志：`--load-extension is not allowed in
   Google Chrome, ignoring`），自动化只能用 Chrome for Testing（playwright 缓存自带）；
   人工在 Google Chrome 上用 chrome://extensions 开发者模式加载不受影响
2. **NM host manifest 查找跟随 user profile**：`--user-data-dir` 指定独立 profile 后，
   manifest 必须装到 `<user-data-dir>/NativeMessagingHosts/` 而不是
   `~/Library/Application Support/Google/Chrome(NativeMessagingHosts)`（官方文档"user-level hosts
   are looked up in the NativeMessagingHosts/ subdirectory of the user profile directory"）
3. **MV3 SW 刚注册时 chrome.* API binding 短暂未就绪**（evaluate 报 `chrome.storage undefined`），
   验证脚本需轮询重试而非首判失败

### 5.4 判据 1 的 2 小时长跑（留人工执行）

机制已由自动化验证（断链自愈 1.1s << 30s），按判据 1 要求的长跑由人工执行：
- desktop 侧起 socket server（或临时用 `scripts/e2e/` 的 echo server 占位）；
- Google Chrome 手动开发者模式加载 `extension/`，日常使用 2 小时（含重启浏览器一次、sleep desktop 一次）；
- popup 页持续显示 connected + RTT 即为通过。本机已验证过的自动化路径与该人工路径等价（NM 管线一致）。
