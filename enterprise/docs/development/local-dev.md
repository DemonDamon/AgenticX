# 本地开发指南

Enterprise 日常开发三条命令：

```bash
cd enterprise
bash scripts/bootstrap.sh      # 首次 / 环境变更
bash scripts/start-dev.sh      # 每天开工（需已有 PG）
# 或
bash scripts/start-dev-with-infra.sh  # 连同 Docker PG/Redis
```

---

## 服务地址

| 服务 | URL |
|---|---|
| 前台 | http://localhost:3000 |
| 后台 | http://localhost:3001 |
| Gateway | http://localhost:8088/healthz |

---

## 默认登录

| 端 | 账号 | 密码 env（bootstrap 时设置，写入 `.env.local`） |
|---|---|---|
| 后台 | `admin@agenticx.local` | 与 `AUTH_DEV_OWNER_PASSWORD` 一致（见下节） |
| 前台 | `admin@agenticx.local` | `AUTH_DEV_OWNER_PASSWORD` |

`staff@agenticx.local` **不在**默认种子中，需后台创建。

> 历史文档偶见 `owner@agenticx.local`；当前 `db-seed.mjs` 写入的是 **`admin@agenticx.local`**。

---

## 密码与登录（env vs Postgres）

本地 dev 配了 `DATABASE_URL` 后，**前台 / 后台密码登录都验 Postgres `users.password_hash`**，不会每次读 `.env.local`。

| 阶段 | 谁决定密码 |
|---|---|
| `bootstrap.sh` → `db:seed` | 用当时环境里的 **`AUTH_DEV_OWNER_PASSWORD`** 做 bcrypt，写入 `users.password_hash` |
| 日常 `start-dev.sh` 重启 | **不**重跑 seed；PG 里 hash **不变** |
| 手动改 `.env.local` 后 | env 与 PG **可能不一致**，直到你重跑 seed |

两个 env 变量的分工：

| 变量 | 作用 |
|---|---|
| `AUTH_DEV_OWNER_PASSWORD` | **`db:seed` 写库**；web-portal 开发态登录；应与 PG 中种子用户密码一致 |
| `ADMIN_CONSOLE_LOGIN_PASSWORD` | bootstrap 交互收集、落盘 `.env.local`；**有 PG 时 admin 登录不读它**（仅无库时的 env 兜底） |

改密码后同步进库（任选其一）：

```bash
cd enterprise
set -a && source .env.local && set +a
pnpm --filter @agenticx/db-schema db:seed
# 或：bash scripts/reset-dev-data.sh --with-seed --yes
```

连续输错 5 次会锁定账号（`failed_login_count` / `locked_until` / `status=locked`），界面仍显示 `invalid credentials`。处置见 [troubleshooting.md#登录与-iam](./troubleshooting.md#登录与-iam)。

---

## bootstrap.sh 选项

```bash
bash scripts/bootstrap.sh                  # local（推荐）
bash scripts/bootstrap.sh --mode=server    # 非交互，env 必须齐全
bash scripts/bootstrap.sh --reset-db       # 销毁 PG 卷重建
bash scripts/bootstrap.sh --skip-docker    # 使用外部 PG
```

执行内容：预检 → `.env.local` → docker PG/Redis → migrate + seed → legacy runtime 导入 → JWT PEM。

---

## start-dev.sh 选项

```bash
bash scripts/start-dev.sh
bash scripts/start-dev.sh --all          # 含 customers/*
bash scripts/start-dev.sh --ui=stream    # 纯日志，Ctrl+C 一次退出
```

- 自动展开 `AUTH_JWT_*_KEY_FILE` PEM
- `AGX_AUTO_DB_MIGRATE=1`：仅 localhost DB 自动 migrate
- Ctrl+C 清理 gateway + Next 子进程

---

## 接通真实模型

**推荐**：后台 → 平台配置 → 模型服务 → 添加 Provider → 检测 → 保存 → 用户可见模型分配。

**备选**：`.env.local` 追加 `DEEPSEEK_API_KEY=sk-...`

---

## OIDC SSO

1. 配置 `NEXT_PUBLIC_SSO_PROVIDERS` 与各 `SSO_*` env
2. 参考 [runbooks/sso-oidc-setup.md](../runbooks/sso-oidc-setup.md)
3. 自检：`pnpm sso:oidc-smoke`

---

## 不用脚本直接 pnpm

```bash
cd enterprise
set -a; source .env.local; set +a
export AUTH_JWT_PRIVATE_KEY="$(cat "$AUTH_JWT_PRIVATE_KEY_FILE")"
export AUTH_JWT_PUBLIC_KEY="$(cat "$AUTH_JWT_PUBLIC_KEY_FILE")"
pnpm install
pnpm exec turbo run dev \
  --filter=@agenticx/app-web-portal \
  --filter=@agenticx/app-admin-console
# gateway 需另开终端 go run ./apps/gateway/cmd/gateway
```

---

## 常用维护

```bash
pnpm migrate:legacy-runtime     # JSON → PG
bash scripts/reset-dev-data.sh  # 清聊天/用量（见 scripts/README）
pnpm typecheck                  # 全 monorepo 类型检查
pnpm --filter @agenticx/app-admin-console test  # 单 app 测试
```

---

## 详细脚本说明

[../scripts/README.md](../scripts/README.md)

---

## 相关文档

- [troubleshooting.md](./troubleshooting.md)
- [../README.md](../README.md)
- [testing/README.md](../testing/README.md)
