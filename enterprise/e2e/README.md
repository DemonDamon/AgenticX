# 管理台 Webhook e2e

独立 npm 项目，不加入 pnpm workspace。用开源 `e2e`（Web 引擎）驱动管理台。

## 前提

1. 管理台已在 `http://localhost:3001` 运行。
2. agent-runtime 已在 `http://127.0.0.1:8092` 运行，并设置 `MA_RUNTIME_WEBHOOKS_ENABLED=1`、`MA_WEBHOOK_ALLOW_LOOPBACK=1`，内部令牌与管理台相同。
3. 导出模型与登录变量（不要写进仓库）：
   - `E2E_MODEL_BASE_URL`
   - `E2E_MODEL_API_KEY`
   - `E2E_MODEL_ID`（需支持工具调用和图片）
   - `ADMIN_CONSOLE_LOGIN_PASSWORD`
   - 可选：`ADMIN_EMAIL`（默认 `admin@agenticx.local`）、`ADMIN_URL`（默认 `http://localhost:3001`）

## 运行

```bash
cd enterprise/e2e
npm install
npx e2e run
```

首次通过后，`agent.act` 会写入 `.e2e/cache/`。再跑同一条用例时，该步骤从缓存回放，不再请求模型。`agent.assert` 每次仍现场判断。

只跑无头浏览器。本地缓存目录 `.e2e/` 已忽略，不要提交密钥或录像。
