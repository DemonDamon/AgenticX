# Enterprise 部署说明

部署有两条路径，按场景选择：

- **本地化 / 私有化（Docker 自托管）**：[`local-selfhost.md`](./local-selfhost.md) —— 自有服务器/内网，Docker 起 Postgres/Redis，运行前台+后台+Gateway 三端，不依赖托管平台。
- **Vercel 托管 + 外部 Gateway**：见下方密钥说明与 [`vercel-env-checklist.md`](./vercel-env-checklist.md)。

---

## 明文密钥放哪里（不入库）

- **真实 PEM、Token、DATABASE_URL** 只允许写在：`enterprise/.local-secrets/`  
- 该目录已在 `enterprise/.gitignore` 中忽略（与 `.env*.local` 同类），**不要提交远端**。
- 建议本地自建文件：`enterprise/.local-secrets/vercel-env-values.local.md`，从  
  [`vercel-env-checklist.md`](./vercel-env-checklist.md) 复制表格后逐项填值。

## 可参考

- [`vercel-env-checklist.md`](./vercel-env-checklist.md)：Vercel 双 Project 环境变量清单（可复制到 `.local-secrets` 后再填）。
