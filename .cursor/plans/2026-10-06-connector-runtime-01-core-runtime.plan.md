# connector-runtime 子计划 01：核心运行时（Go，TDD）

日期：2026-10-06
母计划：[2026-10-06-connector-runtime-master.plan.md](./2026-10-06-connector-runtime-master.plan.md)
状态：执行中
溯源：research/codedeepresearch 归档（锁定 SHA eb4cb13，Evidence E-001~E-016）。**本文件与后续提交不出现上游项目名。**

## 1. 交付目标

单文件二进制 `connector-runtime`，实现母计划九机制的最小可用闭环：

- 声明式连接器定义（JSON）→ 目录（搜索/发现）→ 连接（none + api_key）→ 凭据加密落盘 → SSRF 守护执行 → 动作策略 → 审计 → MCP 5 工具面（无状态 Streamable HTTP）→ runtime/admin 双 token。
- 内置 3 个 no-auth 连接器；CLI 冒烟验证 search → execute 闭环。

## 2. 范围

**做**：上表全部；纯 Go 标准库（零第三方依赖）；macOS/Linux/Windows 交叉编译。

**不做**（归 02/03/04）：OAuth2（04）、桌面 sidecar 集成（02）、企业网关内嵌（03）、YAML 定义、连接器包签名/限流（04）。

## 3. 技术决策

| 决策 | 理由 |
|---|---|
| 模块落点：仓库顶层 `connector-runtime/`（module `github.com/agenticx/connector-runtime`） | 与 desktop/、enterprise/ 平级，双形态共用同一核心，避免漂移 |
| 零第三方依赖 | 单二进制交叉编译最干净；MCP 面手写薄 JSON-RPC 2.0（transport 薄封装，规避 SDK 成熟度风险；参照实现同为手写） |
| 定义格式 JSON | 标准库即可；YAML 后续按需 |
| SSRF 守护：Dialer Control 钩子校验解析后 IP + CheckRedirect 校验 | 每次连接（含重定向）都在拨号前校验，无 TOCTOU 缺口 |
| 默认仅绑定 127.0.0.1；默认拒绝私网/环回目标 | 本地 sidecar 安全基线；`--allow-private-network` 为开发/内网逃生门 |
| token：`--runtime-token`/`--admin-token`，未提供则自动生成并落 dataDir | 双面分离；`--dev-no-auth` 逃生门仅供本地调试 |
| glob 用 `path.Match`（`*` 不跨 `/`） | 动作 ID 无 `/`，语义恰好 |

## 4. 包结构

```
connector-runtime/
  go.mod
  cmd/connector-runtime/main.go       # serve / call / catalog / version
  connectors/*.json                  # go:embed 内置连接器（httpbin / ipinfo / jsonplaceholder）
  internal/model/                     # 定义模型 + 校验
  internal/catalog/                   # 目录投影 + 搜索 + ETag
  internal/secret/                    # AES-GCM + 主密钥管理
  internal/connection/                # 连接存储（凭据加密落盘 JSON）
  internal/policy/                    # 动作 glob allow/block + 连接级 scope 授权
  internal/audit/                     # JSONL 审计 + 脱敏
  internal/executor/                  # SSRF 守护 HTTP 执行器 + 错误语义
  internal/mcp/                       # JSON-RPC 2.0 + 5 工具（纯函数分派）
  internal/server/                    # HTTP 装配（/mcp + /admin/* + /healthz）+ e2e
```

## 5. 任务表（TDD，table-driven，红-绿推进）

| # | 任务 | 先写的验收测试 | 交付物 |
|---|---|---|---|
| T1 | 模型层 | 校验合法/非法定义各维度（id 格式、auth 类型、action 前缀、operationType 枚举、method、path） | internal/model |
| T2 | 目录 | 投影剥离 schema、搜索命中 id/标题/描述/分类、ETag 稳定性 | internal/catalog |
| T3 | 凭据+连接 | AES-GCM 加解密往返、错误密钥失败、主密钥生成复用；连接 CRUD、secret 不出现在列表投影 | internal/secret、internal/connection |
| T4 | 执行器 | 路径/查询/header 模板渲染、缺参 400 语义、私网拦截、重定向目标拦截、超时 504、上游非 2xx 502、api_key 注入 | internal/executor |
| T5 | 策略+审计 | block 优先于 allow、默认放行、scope 子集校验；审计 JSONL 字段完整、敏感键脱敏 | internal/policy、internal/audit |
| T6 | MCP 面 | initialize 握手、tools/list 恰好 5 工具、未知方法 -32601、execute 全链路（含策略拒绝、连接缺失错误码） | internal/mcp、internal/server |
| T7 | CLI+内置连接器 | e2e：真实 HTTP 监听上 initialize→search→guide→execute→admin 建连接→api_key 执行→策略拦截→审计落盘 | cmd/、connectors/、e2e |
| T8 | 构建与冒烟 | 三平台交叉编译通过；本地 mock 上游 search→execute 闭环 | 构建产物（不入库） |
| T9 | 提交 | commit 信息无上游项目名 | 结构化提交 |

## 6. 错误语义（对齐参照实现的 400/502/504）

| 错误码 | 语义 | 触发 |
|---|---|---|
| `provider_input_error` | 调用方输入问题 | 缺参、模板渲染失败、schema 校验失败（400） |
| `ssrf_forbidden` | 出网安全拦截 | 私网/环回/链路本地 IP、非 http(s) scheme、URL 带 userinfo（400） |
| `provider_response_error` | 上游响应异常 | 上游 4xx/5xx、连接失败、响应超限（502） |
| `provider_timeout` | 上游超时 | 超过超时阈值（504） |
| `unknown_action` / `connection_not_found` / `action_blocked` / `scope_denied` | 执行前置校验 | MCP 面 |

## 7. 验收（AC）

- AC-1 `go test ./...` 全绿：单测 + 进程内 e2e（真实 HTTP 栈）。
- AC-2 交叉编译 darwin/arm64、darwin/amd64、linux/amd64、windows/amd64 通过。
- AC-3 本地冒烟（对本地 mock 上游 + `--allow-private-network`）：`call list_apps` → `search_actions` → `get_action_guide` → `execute_action` 返回上游数据；策略 block 后执行被拒；audit.log 有 executionId 记录。
- AC-4 错误语义表中每一行至少一个用例覆盖。
- AC-5 提交与代码注释不含上游项目名。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| MCP 协议细节偏差 | 只实现无状态 Streamable HTTP 最小面（initialize/tools/list/tools/call + notifications 202）；e2e 用真实 JSON-RPC 报文驱动 |
| 交叉编译平台差异 | 零 cgo、纯标准库；构建脚本逐一验证 |
| 定义模型过度设计 | 只留 01 需要的字段；OAuth 字段 04 再加 |
