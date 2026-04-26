# AgenticX Enterprise

> 企业级大模型应用一体化平台 —— 前台 · 后台 · AI 网关三端联动

## 架构

```
enterprise/
├── apps/                      🎯 可部署整机
│   ├── web-portal/            #  员工前台（Next.js）
│   ├── admin-console/         #  管理后台（Next.js）
│   └── gateway/               #  AI 网关（Go，基于 APIPark）
│
├── features/                  🧩 业务功能域（客户挪用主单元）
│   ├── iam/                   身份 · 租户 · 部门 · 角色
│   ├── chat/                  对话工作区
│   ├── model-service/         模型服务管理
│   ├── knowledge-base/        知识库
│   ├── tools-mcp/             工具 · MCP
│   ├── agents/                智能体 · 分身
│   ├── metering/              计量 · 四维查询
│   ├── audit/                 审计日志
│   ├── policy/                敏感规则配置
│   └── settings/              设置面板
│
├── packages/                  📦 技术零件
│   ├── ui/                    shadcn 组件 + 主题
│   ├── branding/              白标组件
│   ├── auth/                  认证抽象（Supabase/LDAP/SSO/账密）
│   ├── db-schema/             Drizzle schema（多租户）
│   ├── core-api/              类型契约
│   ├── policy-engine/         JS 端规则引擎
│   ├── sdk-ts/                TS 客户端 SDK
│   ├── sdk-py/                Python SDK
│   ├── config/                配置加载器
│   └── telemetry/             埋点 · 审计上报
│
├── plugins/                   🔌 运行时插件
│   ├── moderation-pii-baseline/
│   ├── moderation-finance/
│   ├── moderation-medical/
│   ├── tool-watermark/
│   ├── tool-doc-review/
│   └── theme-default/
│
├── deploy/
│   ├── docker-compose/
│   └── helm/
│
└── docs/
```

## 快速开始

### 日常启动（最常用，3 条命令就够）

```bash
cd enterprise
bash scripts/bootstrap.sh     # 只需首次 / 环境/密钥变更时跑
bash scripts/start-dev.sh     # 每天开工跑这一条
```

起来后：

- 前台：<http://localhost:3000>
- 后台：<http://localhost:3001>
- 网关健康检查：<http://localhost:8088/healthz>

登录账号（`bootstrap.sh` 交互设置的密码，落在 `.env.local`）：

- 后台：`owner@agenticx.local` + `ADMIN_CONSOLE_LOGIN_PASSWORD`
- 前台：`owner@agenticx.local` + `AUTH_DEV_OWNER_PASSWORD`
  - 如果输入 `staff@agenticx.local` 会报 `Invalid credentials` —— 默认种子里没有这个人，需要先在后台或注册页创建

> 默认 `owner` 已自带 `workspace:chat` 权限；旧种子环境若 HMR 命中也会被自动补齐，无需手动改库。

### 让聊天回真实模型

未配置 Key 时网关回放 mock 占位回复，链路完整但内容是假的。配真实 Key 走以下两步即可：

1. 在 `enterprise/.env.local` 末尾追加任一 provider 的 Key（变量名规则：`<PROVIDER>_API_KEY`）：

   ```bash
   DEEPSEEK_API_KEY=sk-...
   MOONSHOT_API_KEY=sk-...
   OPENAI_API_KEY=sk-...
   # 或自托管 OpenAI 兼容网关：
   LLM_API_KEY=sk-...
   ```

2. 重启 `bash scripts/start-dev.sh`。前台选 `deepseek-chat` / `moonshot-v1-8k` 等模型即走真调；其余模型若没对应 Key 会自动回退 mock。

详细 Key 解析规则与生产部署建议见 `apps/gateway/README.md`。

### `start-dev.sh` 的 3 个参数（只要记这些）

| 命令 | 行为 |
|---|---|
| `bash scripts/start-dev.sh` | 默认，仅拉起 enterprise 的 web-portal + admin-console |
| `bash scripts/start-dev.sh --all` | 同时拉起 `customers/*`（如 hechuang 的 `:3100/:3101`） |
| `bash scripts/start-dev.sh --ui=stream` | 关闭 Turbo TUI，输出纯日志（Ctrl+C 一次就退） |
| `bash scripts/start-dev.sh --help` | 随时查 |

> Turbo TUI 的小提示：默认 `tui` 模式下，用 `↑/↓` 切任务、`/` 搜索、`q` 退出。如果感觉"卡住/Ctrl+C 没反应"，先按 `Esc` 再按 `q`，或直接改用 `--ui=stream`。

### 企业服务器部署（不交互）

```bash
export DATABASE_URL='postgresql://...'
export AUTH_JWT_PRIVATE_KEY="$(cat /secure/path/auth_private.pem)"
export AUTH_JWT_PUBLIC_KEY="$(cat /secure/path/auth_public.pem)"
export ADMIN_CONSOLE_LOGIN_PASSWORD='...'
export ADMIN_CONSOLE_SESSION_SECRET='...'
bash scripts/bootstrap.sh --mode=server
```

`bootstrap.sh` 要点：

1. 预检 node/pnpm/go/docker/openssl
2. 写入 `enterprise/.env.local`（chmod 600，已 `.gitignore`）
3. 若缺少密码 → 交互提示（强度校验）；`--mode=server` 下直接失败
4. `pnpm install`
5. 启动 postgres + redis（local）；server 模式跳过
6. 跑 `db:migrate` + `db:seed`
7. 生成 RSA-2048 JWT 密钥对至 `enterprise/.local-secrets/`（local）

常用选项：

- `--reset-db`：`docker compose down -v` 后重建（仅开发）
- `--skip-docker`：本机已有独立 postgres，不经 compose
- `--mode=server`：非交互，全部密钥/密码必须来自外部环境变量

### 不用脚本，直接 pnpm（知道自己在做什么时）

```bash
# 在 enterprise/ 根目录，环境变量需自行注入
set -a; source .env.local; set +a
# .env.local 里存的是 *_FILE，需要手动展开 PEM 内容
export AUTH_JWT_PRIVATE_KEY="$(cat "$AUTH_JWT_PRIVATE_KEY_FILE")"
export AUTH_JWT_PUBLIC_KEY="$(cat "$AUTH_JWT_PUBLIC_KEY_FILE")"
pnpm install
pnpm exec turbo run dev \
  --filter=@agenticx/app-web-portal \
  --filter=@agenticx/app-admin-console
```

## 产品定位

- **护城河**：桌面端（Machi）+ 后台管理 + AI 网关三端联动
- **差异化**：支持"云端统一管控 + 端侧安全闭环"混合模式
- **商业模式**：开源主干 + 客户专属定制（定制代码在独立私有仓 `customers/*`）

## 给客户项目挪用 enterprise 模块

见 `docs/guides/2026-04-21-enterprise-customers-collaboration.md`

## 相关文档

- 产品架构：`../docs/plans/2026-04-21-agenticx-enterprise-architecture.md`
- 插件协议：`./docs/plugin-protocol/`
- API 契约：`./docs/api/`
- 部署手册：`./docs/deployment/`

## License

Apache 2.0（与 AgenticX 主仓一致）
