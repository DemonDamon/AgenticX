# Enterprise MOMA 厂商探活与配置校验

## 背景

admin-console「检测」对移动云 MOMA（`https://moma.cmecloud.cn/v1`）误报「连通超时（8s）」；前台聊天偶发 `upstream request failed: ... EOF`。

## 根因

1. **探活**：`GET /models` 超时后直接返回，未回落 `POST /chat/completions`；「检测」未提交表单里的 `baseUrl` 草稿。
2. **配置**：厂商 ID 填中文（如「移动云」）经 `normalizeProviderId` 变成 `---`；模型 ID 误填前台格式 `ZHIPU/GLM-5.1`，应填上游 `minimax/minimax-m3`。

## 改动

- `test/route.ts`：models 短超时 + chat 回落；支持 `baseUrl`/`probeModel` 草稿。
- `models/page.tsx`：`handleTest` 传 `baseUrlDraft` 与 probe 模型。
- `model-providers-store.ts`：厂商 ID 校验（禁止纯 `-`、须 ASCII slug）。
- i18n + 添加模型/厂商表单说明文案。

## 验收

- AC-1：MOMA baseUrl + Key 点「检测」在未保存 baseUrl 草稿时也能成功或给出 Key/模型明确错误。
- AC-2：新建厂商 ID 填中文时 admin 拒绝并提示填 `moma` 等英文 slug。
- AC-3：用户按 `moma` + 模型 `minimax/minimax-m3` 配置后，web-portal 聊天可达。
