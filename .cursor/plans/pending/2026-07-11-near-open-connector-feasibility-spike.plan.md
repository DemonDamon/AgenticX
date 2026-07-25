---
name: ""
overview: ""
todos: []
isProject: false
---

# Near × OpenConnector 可行性 Spike

Planned-with: gpt-5.6-sol-medium
Suggested-Impl-Model: grok-4.5-medium
Status: implementation-ready spike

## 目标

用可复现证据回答 Near 是否应把 OpenConnector 作为本地 sidecar 集成。Spike 只做临时运行、测量、协议核验和 ADR，不修改生产 Electron、设置页、MCP 配置或打包流水线。

只有全部强制门禁通过，才允许另写正式实施计划。正式实施必须拆为：

1. Runtime 与跨平台打包
2. Electron 生命周期与安全边界
3. 设置 UI、授权流程与 MCP 接线

本文件不是上述正式实施计划，禁止实施者越过 Go/No-Go 直接修改生产代码。

## 已固定的事实

- 上游：`https://github.com/oomol-lab/open-connector`
- 固定 commit：`dec9989331d770b916336388cf194fcd3f1ed186`
- License：Apache-2.0；第三方 provider 品牌资产不随源码许可证自动授权
- Node 运行时目标：Node 22
- 数据目录环境变量：`OOMOL_CONNECT_DATA_DIR`
- 实际数据库：`<data-dir>/connect.sqlite`
- 强制绑定：`HOST=127.0.0.1`
- OAuth origin：`OOMOL_CONNECT_ORIGIN=http://127.0.0.1:<port>`
- 凭证加密：`OOMOL_CONNECT_ENCRYPTION_KEY`
- 管理面鉴权：`OOMOL_CONNECT_ADMIN_TOKEN`
- MCP/Runtime 鉴权：`OOMOL_CONNECT_RUNTIME_TOKEN`
- MCP endpoint：`POST /mcp`
- MCP 固定工具：`list_apps`、`search_actions`、`get_action_guide`、`execute_action`
- 管理 API：`GET /api/providers`、`GET /api/connections`
- 存活检查：`GET /health`
- Runtime 检查：带 Runtime Token 请求 `GET /mcp/tools`

## 默认决策原则

1. 不依赖终端用户预装 Node。
2. 不把任何共享 OAuth client secret 打入 Near 安装包。
3. 不向渲染进程暴露 Admin Token、Runtime Token 或 encryption key。
4. 不默认把连接器 MCP 自动开放给全部分身；正式产品必须由用户显式启用。
5. 不把 OpenConnector Action 误建模为数千个 MCP tools；Near 只接入四个固定发现/执行工具。
6. Web Console 是否使用受控 BrowserWindow，必须由本 Spike 的安全预认证实验证明；失败则回退系统浏览器手动解锁。

## 实施者开始前必须读取

### AgenticX

- `desktop/electron/main.ts:2833-2956`：微信 HTTP sidecar 范式
- `desktop/electron/main.ts:3993-4007`：微信 sidecar IPC
- `desktop/electron/main.ts:7671-7679`：退出清理
- `desktop/electron/preload.ts`
- `desktop/src/global.d.ts`
- `desktop/src/utils/mcp-remote-config.ts`
- `desktop/src/App.tsx:424-466`
- `desktop/electron-builder.yml`
- `desktop/electron-builder.signing.yml`
- `desktop/scripts/verify-bundled-backend.js`
- `.github/workflows/build-desktop.yml`
- `packaging/build_backend.sh`
- `packaging/build_windows_installer.ps1`

### OpenConnector（固定 commit）

- `package.json`
- `Dockerfile`
- `docs/configuration.md`
- `docs/runtime-api.md`
- `src/server/index.ts`
- `src/server/api/auth.ts`
- `web/src/api.ts`
- `web/src/ui.tsx`
- `migrations/`

## Spike 产物

只允许创建或修改：

- `research/codedeepresearch/open-connector/spike/runtime-contract.md`
- `research/codedeepresearch/open-connector/spike/security-contract.md`
- `research/codedeepresearch/open-connector/spike/console-oauth-contract.md`
- `research/codedeepresearch/open-connector/spike/mcp-contract.md`
- `research/codedeepresearch/open-connector/spike/packaging-matrix.md`
- `research/codedeepresearch/open-connector/spike/decision.md`
- `research/codedeepresearch/open-connector/spike/evidence/` 下的脱敏日志与测量结果

禁止把上游 clone、`node_modules`、SQLite、Token、OAuth code、API Key 或测试凭证写入 AgenticX 仓库。

## Task 1：建立可复现上游基线

### 操作

1. 在系统临时目录浅克隆：

```bash
UPSTREAM_DIR="${TMPDIR:-/tmp}/agenticx-open-connector-dec9989"
rm -rf "$UPSTREAM_DIR"
git clone --filter=blob:none --no-checkout https://github.com/oomol-lab/open-connector "$UPSTREAM_DIR"
git -C "$UPSTREAM_DIR" checkout dec9989331d770b916336388cf194fcd3f1ed186
git -C "$UPSTREAM_DIR" rev-parse HEAD
```

2. 预期 SHA 必须严格等于：

```text
dec9989331d770b916336388cf194fcd3f1ed186
```

3. 使用临时 Node 22 + npm 10 环境执行安装与测试；不得修改 AgenticX `package.json`，也不得让系统旧 Node 执行上游 lifecycle scripts：

```bash
cd "$UPSTREAM_DIR"
npx --yes --package=node@22 --package=npm@10 --call 'node --version && npm --version && npm ci'
npx --yes --package=node@22 --package=npm@10 --call 'node --version && npm test'
```

4. 将 commit、Node/npm 版本、`npm ci` 用时、测试结果和上游 License/NOTICE 路径写入 `runtime-contract.md`。

### 停止条件

- checkout SHA 不一致
- `npm ci` 或上游测试失败
- 安装过程需要未记录的系统服务

任一发生即记录 `NO-GO: upstream baseline failed`，后续任务不继续。

## Task 2：验证运行时、数据目录与迁移

### 固定环境

临时生成三类高熵 secret；只保存在进程环境和临时目录，日志必须脱敏：

```text
OOMOL_CONNECT_ENCRYPTION_KEY
OOMOL_CONNECT_ADMIN_TOKEN
OOMOL_CONNECT_RUNTIME_TOKEN
```

启动环境必须包含：

```text
HOST=127.0.0.1
PORT=<临时空闲端口>
OOMOL_CONNECT_ORIGIN=http://127.0.0.1:<同一端口>
OOMOL_CONNECT_DATA_DIR=<临时目录>/data
```

首次启动前执行一次生成步骤：

```bash
cd "$UPSTREAM_DIR"
npx --yes node@22 scripts/ensure-generated.ts
```

随后用 Node 22 启动；不得直接调用可能落到系统旧 Node 的 `npm start`：

```bash
env \
  HOST="127.0.0.1" \
  PORT="<临时空闲端口>" \
  OOMOL_CONNECT_ORIGIN="http://127.0.0.1:<同一端口>" \
  OOMOL_CONNECT_DATA_DIR="<临时目录>/data" \
  OOMOL_CONNECT_ENCRYPTION_KEY="<临时高熵值>" \
  OOMOL_CONNECT_ADMIN_TOKEN="<临时高熵值>" \
  OOMOL_CONNECT_RUNTIME_TOKEN="<临时高熵值>" \
  npx --yes node@22 src/server/index.ts
```

`<...>` 是实施者从测试 harness 注入的变量，不得把真实 secret 写入命令历史、Markdown 或 evidence。建议由临时脚本生成环境并启动进程，脚本在 Spike 结束时删除。

### 验证

1. 首次启动后，`GET /health` 在 10 秒内返回 200。
2. `connect.sqlite` 只出现在指定 data 目录。
3. 结束进程后再次启动，migration 不报错，已有数据可读。
4. 进程收到 SIGTERM 后在 5 秒内退出，SQLite 可再次打开。
5. 监听地址只能是 `127.0.0.1`；发现 `0.0.0.0`、`::` 或局域网地址立即 NO-GO。
6. 连续冷启动 5 次，记录 ready 时间与 idle RSS。

### 初始性能门禁

- 冷启动 p95 ≤ 8 秒
- idle RSS ≤ 250 MB
- 5 次启动成功率 100%

结果写入 `runtime-contract.md`，原始时间与 RSS 数据写入 `evidence/runtime-metrics.json`。

## Task 3：验证本地安全边界

### 必测请求

1. 不带 Token 请求 `/api/connections`：预期 401。
2. 带 Admin Token 请求 `/api/connections`：预期 200。
3. 不带 Token 请求 `/mcp/tools`：预期 401。
4. 带 Runtime Token 请求 `/mcp/tools`：预期 200。
5. 错误 Token：预期 401，响应和日志不得回显 Token。
6. 带恶意 `Origin` 的管理写请求：记录上游当前响应；若未拒绝，标记需要主进程代理或上游安全 patch，不能直接暴露给渲染层。
7. 检查 SQLite 与日志是否出现用于探测的明文凭证 sentinel；启用 encryption key 后不得在 SQLite 中搜索到 sentinel。

### Threat model 最低输出

`security-contract.md` 必须明确：

- 本机恶意进程
- 恶意网页访问 localhost / DNS rebinding
- Renderer XSS 后访问 sidecar
- Token/SQLite/日志泄露
- 高风险 Action 被提示注入调用
- 上游源码、npm 依赖、Node 二进制供应链

并为每项给出：攻击路径、现有上游控制、Near 必须补的控制、剩余风险。

### 强制结论

- Admin API 必须由 Electron 主进程代理。
- Renderer 只能获得脱敏状态，不得获得三类 secret。
- 正式实现必须使用 0700 数据目录、0600 敏感文件并拒绝符号链接。
- encryption key 是长期密钥，正式实现应使用 Electron `safeStorage` 保存。
- Admin/Runtime Token 可每次 Near 启动重新生成；正式实现必须原子更新 MCP Authorization header。

## Task 4：验证 Console 与授权流程

### 无需外部凭证即可完成

1. 启用 Admin Token 打开 Web Console。
2. 确认未认证状态进入 unlock UI。
3. 输入正确 Admin Token 后确认 HttpOnly、SameSite=Strict 管理 Cookie 生效。
4. 查明 provider 详情是否有稳定深链；记录 URL 形式，不允许猜测。
5. 验证 no-auth provider 从目录到执行结果的完整 UI 流。

### 受控 BrowserWindow 预认证实验

只做临时实验，不修改生产 `main.ts`：

1. 使用独立 Electron session partition。
2. 由主进程网络会话携带 `Authorization: Bearer <Admin Token>` 请求 `/api/auth/session`。
3. 验证服务端 Set-Cookie 是否进入同一 partition。
4. 再加载 Console，确认不再显示 unlock UI。
5. 禁用 Node integration；启用 sandbox/contextIsolation；不挂载 Near preload。
6. 验证第三方 OAuth 跳转不会获得 Electron 特权。

### 需要测试凭证的条件任务

用户提供测试凭证时，各验证一项：

- API Key provider：GitHub 或等价测试账号
- OAuth provider：Gmail、Slack、Notion 中任一

若未提供凭证，不得编造成功；在 `console-oauth-contract.md` 标记 `INCONCLUSIVE`，最终决策不得为完整 GO。

### 固定回退顺序

1. 受控 BrowserWindow 预认证通过：正式计划可采用 BrowserWindow。
2. 预认证失败但系统浏览器 unlock 可用：回退系统浏览器手动解锁。
3. 深链或状态闭环不稳定：只打开 Console 首页并由用户手动刷新。
4. 三者都不能接受：正式计划必须改为首批 provider 的 Near 原生薄授权页，不得继续声称复用 Console。

## Task 5：验证 MCP 契约

### 配置形状

Near 现有远程 MCP 配置应等价于：

```json
{
  "mcpServers": {
    "open-connector": {
      "url": "http://127.0.0.1:<port>/mcp",
      "headers": {
        "Authorization": "Bearer <Runtime Token>"
      },
      "timeout": 60
    }
  }
}
```

### 必测链路

1. `GET /mcp/tools` 返回四个固定工具。
2. `list_apps`
3. `search_actions` 搜索 `hackernews`
4. `get_action_guide` 获取 no-auth Action 指南
5. `execute_action` 执行 no-auth Action
6. 0 个连接、1 个连接和多个 alias 的返回结构
7. Token 错误、Action 不存在、provider 未授权、上游超时
8. 单次响应大小、发现耗时和注入模型时的工具 schema token 量

### 结论约束

- 不得写“1000+ Action 自动进入工具列表”。
- 正式计划必须复用 `buildRemoteMcpServerPayload` 写 `~/.agenticx/mcp.json`。
- 正式计划必须调用现有 `connectMcp`，由现有成功连接副作用维护 `mcp.auto_connect`。
- 默认采用用户显式启用；不得静默自动连接并开放给全部分身。
- 必须在后续正式计划定义 provider、alias、Action 与分身权限边界。

## Task 6：比较三种分发边界

### A. 全量内嵌

测量固定 commit 的：

- Node 22 runtime
- production `node_modules`
- server source/generated catalog
- Web Console 静态产物
- migrations

记录压缩前后总大小、文件数、当前 macOS 架构启动结果和升级成本。

### B. 首次按需下载

设计并验证临时原型：

- HTTPS 下载
- 固定版本 manifest
- SHA-256 校验
- 原子解压
- 断点失败清理
- 版本回滚保护
- 离线错误提示

不得在 Spike 中接入 Near 自动更新。

### C. 用户自管 localhost

验证 Near 仅配置 Base URL + Runtime/Admin Token 时，Console、管理 API 和 MCP 是否可用。记录用户配置复杂度和故障诊断要求。

### 初始门禁

全量内嵌只有同时满足以下条件才可入选：

- DMG/NSIS 压缩产物预计增量 ≤ 200 MB
- 安装后增量 ≤ 350 MB
- 不依赖系统 Node
- 当前 macOS 架构启动门禁通过
- Windows x64、macOS arm64/x64 均存在可复现构建方案

若全量内嵌失败，优先选择首次按需下载；若按需下载的签名、回滚或离线体验不达标，则只保留用户自管 localhost 模式。

`packaging-matrix.md` 必须记录每种方案的证据、门禁结果、升级策略、供应链控制和推荐结论。

## Task 7：形成 Go/No-Go ADR

`decision.md` 必须逐项使用：

```text
PASS | FAIL | INCONCLUSIVE
```

至少包含：

- 上游基线
- 本地运行与迁移
- 回环监听
- 三类 secret 与鉴权
- Console 解锁
- BrowserWindow 预认证
- no-auth Action
- API Key provider
- OAuth provider
- MCP 四工具链
- 分发边界
- macOS/Windows 可复现性
- 许可证、NOTICE、SBOM 与签名要求

### 总决策

- 任一安全强制项 FAIL：`NO-GO`
- API Key 或 OAuth 因缺少测试凭证未验证：`INCONCLUSIVE`，不得进入完整生产实施
- 全量内嵌 FAIL 但按需下载 PASS：允许后续计划采用按需下载
- 只有全部强制项 PASS，才输出 `GO`

### GO 后必须生成的三个正式 Plan

1. `.cursor/plans/YYYY-MM-DD-near-open-connector-runtime-packaging.plan.md`
2. `.cursor/plans/YYYY-MM-DD-near-open-connector-lifecycle-security.plan.md`
3. `.cursor/plans/YYYY-MM-DD-near-open-connector-ui-mcp-integration.plan.md`

每份正式 Plan 必须引用 `decision.md` 中的具体 PASS 证据，不能重新引入本 Spike 已淘汰的方案。

## Verification Contract

执行完成后：

1. 确认 `git status` 中只有本计划允许的 research Markdown/脱敏 evidence。
2. 确认不存在上游 clone、`node_modules`、SQLite、Token、测试凭证或构建二进制。
3. 搜索 evidence，确保不存在 `Authorization: Bearer` 的真实值、OAuth code、API Key、Cookie。
4. 所有结论必须带命令、版本、时间、退出码或响应状态；禁止仅写“已验证”。

## Definition of Done

- 六份 Spike 文档和脱敏 evidence 完整
- 每个门禁都有 PASS/FAIL/INCONCLUSIVE
- 未修改任何生产代码或配置
- `decision.md` 给出唯一推荐分发边界与授权窗口策略
- 未达到 GO 时没有生成正式实施 Plan
- 达到 GO 时只生成后续 Plan，不在本 Spike 会话直接实施