# Enterprise 部署说明（Vercel + 外部 Gateway）

## 明文密钥放哪里（不入库）

- **真实 PEM、Token、DATABASE_URL** 只允许写在：`enterprise/.local-secrets/`  
- 该目录已在 `enterprise/.gitignore` 中忽略（与 `.env*.local` 同类），**不要提交远端**。
- 建议本地自建文件：`enterprise/.local-secrets/vercel-env-values.local.md`，从  
  [`vercel-env-checklist.md`](./vercel-env-checklist.md) 复制表格后逐项填值。

## 可参考

- [`vercel-env-checklist.md`](./vercel-env-checklist.md)：Vercel 双 Project 环境变量清单（可复制到 `.local-secrets` 后再填）。
