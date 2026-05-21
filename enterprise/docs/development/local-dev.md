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

| 端 | 账号 | 密码 env |
|---|---|---|
| 后台 | `owner@agenticx.local` | `ADMIN_CONSOLE_LOGIN_PASSWORD` |
| 前台 | `owner@agenticx.local` | `AUTH_DEV_OWNER_PASSWORD` |

`staff@agenticx.local` **不在**默认种子中，需后台创建。

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
