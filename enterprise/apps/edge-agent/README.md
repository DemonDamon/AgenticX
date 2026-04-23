# AgenticX Edge Agent

> 🛡️ **端侧安全闭环 Sidecar** — 自研 · Go · 单二进制 · 最小权限

企业员工桌面 / 边缘算力节点上常驻的轻量代理，负责 **本地模型推理闭环** 和 **脱敏审计上送**，确保原始对话数据不出端。

对齐客户 A技术规范书 V20260422 §1.5(2)「端侧本地模型路由」「数据不出网关」验收指标。

---

## 定位与边界

```
┌────────────────────────────────────────────────┐
│  用户桌面 / 边缘节点                            │
│                                                 │
│  ┌────────────┐       IPC (127.0.0.1)          │
│  │   Machi    │◄──────────────►  ┌──────────┐  │
│  │  Desktop   │   + Token Auth    │   Edge   │  │
│  │            │                   │   Agent  │  │
│  │            │                   │ (Go bin) │  │
│  └────────────┘                   └────┬─────┘  │
│                                        │        │
│                                        ▼        │
│                                  ┌──────────┐  │
│                                  │  Ollama  │  │
│                                  │  边缘模型 │  │
│                                  └──────────┘  │
└────────────────────────────────────────────────┘
                      │
                      │  脱敏摘要（HTTPS）
                      ▼
          ┌──────────────────────┐
          │  AgenticX Gateway    │ （企业侧）
          │  /edge/audit         │
          └──────────────────────┘
```

**只做三件事：**

1. **本地模型路由**：接收 Machi 的推理请求 → 转发 Ollama → 流式返回
2. **Workspace 沙箱**：管控文件读写路径白名单
3. **审计摘要上送**：脱敏后的交互摘要 + token/cost 异步上送企业网关

**不做：** 原始对话 / 原始文件内容 / 模型权重 → 任何形式的外发

---

## 为什么选 Go

| 维度 | Rust | Go | Node | 结论 |
|---|---|---|---|---|
| 内存安全 | ✅✅ | ✅ | ⚠️ | Rust 最强 |
| 单二进制 | ✅ | ✅ | ❌（需打包） | Go/Rust 同等 |
| 并发流式 | ✅ | ✅ | ✅ | 都够 |
| 团队可维护 | 低 | 高 | 高 | Go 最好 |
| 供应链安全 | 生态小 | 生态成熟 | npm 供应链风险高 | Go 最稳 |
| 与 gateway 同栈 | ❌ | ✅ | ❌ | Go 胜 |

**决策**：Go 1.22+，标准库为主，依赖严格评估。

---

## 安全威胁模型与对策

详细参见 [`docs/security-model.md`](./docs/security-model.md)。核心基线：

### 1. 监听面最小化

- ✅ 仅绑定 `127.0.0.1:7823`（随机分配端口，避免公网暴露）
- ✅ 启动时校验 socket family，拒绝 `0.0.0.0`
- ❌ 禁止监听 Unix Domain Socket 在世界可读目录

### 2. 客户端鉴权

- ✅ **每次启动生成一次性 Token**，写入用户家目录 `~/.agenticx/edge.token`（mode 0600）
- ✅ Machi 通过读文件获取 Token，每次请求带 `Authorization: Bearer <token>`
- ✅ 可选 **mTLS**：企业部署可下发客户端证书，拒绝非签发方连接
- ❌ 不使用固定硬编码密钥

### 3. 输入校验

- ✅ 所有 API 入参走结构化 schema（`pkg/types` 定义）
- ✅ 路径参数**必须 normalize + 白名单校验**（防 path traversal）
- ✅ 请求体大小限制（默认 10MB，可配置）
- ✅ 超时控制（默认 read/write timeout 60s）
- ❌ 不允许任意 shell 执行 / eval

### 4. Workspace 沙箱

- ✅ 所有文件操作走 `internal/sandbox` 统一封装
- ✅ 用户工作区路径**至少走三次校验**：`filepath.Clean` → `filepath.EvalSymlinks` → 白名单前缀匹配
- ✅ 禁止访问：`/etc`、`/root`、`~/.ssh`、`~/.agenticx/edge.token`、其他用户的家目录
- ❌ 不允许任何"跳出工作区"的路径（`../`、symlink 越狱）

### 5. 脱敏引擎

- ✅ 上送前经过 `internal/redact` 层：
  - PII 正则（手机/邮箱/身份证/银行卡）
  - 客户端注入的自定义规则
  - 整段 prompt / response 原文 **绝不外发**
- ✅ 只上送：摘要（≤500 字）、token 计数、cost、工具调用名（无参数）
- ✅ 本地保留完整日志供管理员本机审阅，但仅限 agent 运行账户

### 6. 日志完整性

- ✅ 本地日志使用 **append-only + checksum 链**（类 Git blake2b）
- ✅ 重要事件（鉴权失败、越权尝试、脱敏规则命中）即时落盘
- ✅ 日志文件 mode 0600

### 7. 供应链安全

- ✅ `go.mod` 依赖白名单（见 `docs/supply-chain.md`）
- ✅ CI 必跑 `govulncheck` + `nancy` + SBOM 生成
- ✅ 二进制构建 reproducible build（可复现）
- ❌ 拒绝引入无活跃维护的小众包

### 8. 最小权限

- ✅ **非 root 运行**：建议 systemd 以专属 `agenticx-edge` 用户跑
- ✅ macOS 使用 LaunchAgent（用户级，非 daemon）
- ✅ Windows 使用 NSSM / Service Wrapper，指定专属用户
- ❌ 不 `setuid` / `setcap`

### 9. 自升级安全

- ✅ 升级包**必须有签名**（Ed25519）
- ✅ 签名验证通过才替换二进制
- ❌ 不支持明文 HTTP 拉取

### 10. 卸载与密钥擦除

- ✅ 卸载时清理 `~/.agenticx/edge.token`、本地日志（可选保留以供审计）
- ✅ 远程冻结支持（管理后台下发 disable 信号）— 对应技术规范书 §2.5 远期规划

---

## 目录结构

```
apps/edge-agent/
├── cmd/edge-agent/           # 可执行入口
│   └── main.go
├── internal/                 # 私有实现（Go 惯例，禁止外部 import）
│   ├── api/                  # HTTP API 层（127.0.0.1）
│   │   ├── server.go
│   │   ├── middleware.go     # 鉴权/限流/日志
│   │   └── handlers_*.go
│   ├── router/               # 本地 vs 云模型路由决策
│   ├── ollama/               # Ollama 客户端封装
│   ├── sandbox/              # Workspace 路径白名单
│   ├── redact/               # 脱敏引擎
│   ├── uploader/             # 审计摘要异步上送
│   └── security/             # Token/TLS/签名/完整性日志
├── pkg/                      # 可导出工具（供 Machi 集成用，极少）
│   └── types/
├── docs/
│   ├── security-model.md     # 威胁模型与对策
│   ├── api.md                # API 合约
│   └── supply-chain.md       # 依赖审计
├── go.mod
├── go.sum                    # 锁定版本 + 签名
└── Makefile
```

---

## API 合约（草案）

所有请求：`Authorization: Bearer <token>`（从 `~/.agenticx/edge.token` 读取）

### 本地模型推理

```
POST /v1/chat/completions
  → 代理转发到 Ollama
  → 流式 SSE 返回
  → 不落盘原始内容，只生成脱敏摘要
```

### Workspace 文件访问（受沙箱约束）

```
POST /v1/workspace/read   body: { path, session_id }
POST /v1/workspace/write  body: { path, content, session_id }
POST /v1/workspace/list   body: { path }
```

### 健康检查

```
GET /healthz                (免鉴权，仅返回 ok)
GET /v1/status              (需鉴权，返回详细状态)
```

### 审计摘要（Machi → Edge Agent，而后异步上送 Gateway）

```
POST /v1/audit/ingest       body: AuditDigest
```

---

## 构建与发布

```bash
cd enterprise/apps/edge-agent
go build -o bin/edge-agent ./cmd/edge-agent

# Reproducible build
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -buildid=" \
    -o bin/edge-agent ./cmd/edge-agent

# 生成 SBOM
syft bin/edge-agent -o cyclonedx-json > bin/edge-agent.sbom.json
```

---

## 相关文档

- [威胁模型与对策](./docs/security-model.md)
- [API 合约](./docs/api.md)
- [供应链审计](./docs/supply-chain.md)
- [主架构文档](/docs/plans/2026-04-21-agenticx-enterprise-architecture.md)
- [ADR-0001 开源选型](/enterprise/docs/adr/0001-oss-foundations-selection.md)
