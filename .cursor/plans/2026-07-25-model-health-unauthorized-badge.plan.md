# 模型健康检查「未授权」标签

Planned-with: cursor-grok-4.5  
Suggested-Impl-Model: composer-2.5

> **For implementers:** 本 plan 须可被 Composer 2.5 在无对话上下文下独立高质量落地。

## Goal

OpenAI 兼容网关（如移动云 MOMA）的 `GET /models` 常返回完整目录，但 API Key 对部分模型无调用权限（chat 返回 `401 Request denied by Model Auth check. Invalid model.`）。用户点「批量健康检查」后，须将此类失败与一般连通失败区分，在设置页模型列表打上「未授权」标签；**不得**在「从 API 获取模型」时静默过滤目录。

## Architecture

1. 纯函数分类探活失败原因（可单测）。
2. Electron `health-check-model` IPC 在失败时附带 `reason: "unauthorized" | "error"`。
3. `SettingsPanel` 的 `ModelHealthEntry` 增加 `unauthorized` phase，UI 显示琥珀色「未授权」标签（HoverTip 可带截断错误原文）。
4. 「从 API 获取模型」逻辑零改动。聊天选择器本波不灰显、不持久化健康态（仍可选；点了继续走现有失败文案）。

## In scope

- FR-1: 探活失败若命中网关 Model Auth / Invalid model 类文案，归类为 `unauthorized`。
- FR-2: 设置 → 模型服务 → 模型列表行：单条「检测」与「批量健康检查」在 `unauthorized` 时显示「未授权」（非「失败」）。
- FR-3: 其它 HTTP/网络失败仍显示「失败」。
- FR-4: 成功仍显示延迟 + 绿勾。

## Out of scope

- 「从 API 获取模型」过滤未授权模型。
- 聊天模型选择器灰显 / 禁用未授权项。
- 健康状态持久化到 `config.yaml` / localStorage。
- 自动并发探活或改超时策略（保持现有串行批量检查）。
- Enterprise admin-console / web-portal。

## Root cause / evidence

本机对 `https://moma.cmecloud.cn/v1`：`Kimi/Kimi-K2.6`、`ZHIPU/GLM-5.2` 等 chat 返回 `401 Request denied by Model Auth check. Invalid model.`；同 Key 下 `minimax/MiniMax-M3`、`ZHIPU/GLM-5.1` 为 200。`/models` 仍列出未授权模型。LiteLLM 将上游 401 包装为 `AuthenticationError`，属透传，非 Desktop 路由 bug。

## Suggested-Impl-Model 子任务表

| 子任务 | 推荐模型 | 理由 |
|--------|----------|------|
| classify 纯函数 + 单测 | composer-2.5 | 样板逻辑 |
| IPC + SettingsPanel UI | composer-2.5 | 局部接线，无跨栈风险 |

---

### Task 1: 失败分类纯函数 + 测试

**Files:**
- Create: `desktop/electron/model-health.ts`
- Create: `desktop/tests/model-health.test.ts`

**API:**

```ts
export type ModelHealthFailureReason = "unauthorized" | "error";

export function classifyModelHealthFailure(
  status: number,
  body: string,
): ModelHealthFailureReason
```

**规则（全部大小写不敏感，body 取原文即可）：**

命中以下任一 → `"unauthorized"`：
- `status === 401` 且 body 含 `invalid model`
- body 含 `model auth check`
- body 含 `request denied by model auth`
- body 含中文「未授权」且同时含「模型」（避免误伤纯 Key 错误：仅「未授权」不够）

其余 → `"error"`（含 401 但文案为 invalid api key / incorrect api key 等）。

**AC-1:**  
`npx vitest run tests/model-health.test.ts`（cwd: `desktop/`）全绿；至少覆盖：
- `401` + `Request denied by Model Auth check. Invalid model.` → unauthorized  
- `401` + `Incorrect API key provided` → error  
- `500` + 任意 → error  
- `404` + empty → error  

---

### Task 2: IPC 返回 reason

**Files:**
- Modify: `desktop/electron/main.ts` — `health-check-model` handler（约 L10391–10437）
- Modify: `desktop/electron/preload.ts` — `healthCheckModel` 返回类型（若有显式类型则同步）
- Modify: `desktop/src/global.d.ts` — `HealthCheckResult`（约 L59）

**Before（失败分支语义）：**
```ts
return { ok: false, error: `HTTP ${resp.status}: ${errBody.slice(0, 200)}` };
```

**After:**
```ts
import { classifyModelHealthFailure } from "./model-health";
// ...
const reason = classifyModelHealthFailure(resp.status, errBody);
return {
  ok: false,
  error: `HTTP ${resp.status}: ${errBody.slice(0, 200)}`,
  reason,
};
```

`HealthCheckResult` 扩为：
```ts
type HealthCheckResult = {
  ok: boolean;
  error?: string;
  latencyMs?: number;
  reason?: "unauthorized" | "error";
};
```

catch 分支可不设 `reason`（前端当 `error`）。

**AC-2:** TypeScript 编译无新增错误；失败路径带 `reason`。

---

### Task 3: SettingsPanel UI

**Files:**
- Modify: `desktop/src/components/SettingsPanel.tsx`

**锚点：**
1. `ModelHealthEntry`（约 L891–894）增加 `| { phase: "unauthorized"; error?: string }`
2. `onHealthCheck` / `onBatchHealthCheck`（约 L7126–7160）：`!res.ok` 时若 `res.reason === "unauthorized"` → `{ phase: "unauthorized", error: res.error }`，否则 `{ phase: "error" }`
3. 模型行渲染（约 L8931–8938）：
   - `unauthorized`：琥珀色小标签文案「未授权」（可用 `text-amber-400/90`）；包一层 `HoverTip`，label 为 `entry.error` 截断至 120 字或「当前密钥无权调用此模型」
   - `error`：保持「失败」
   - 可选：unauthorized 行 `opacity-80`（勿大改布局栅格）

**AC-3:** 手动：MOMA 可见列表含 `Kimi/Kimi-K2.6`，点批量健康检查后该行显示「未授权」而非「失败」；`minimax/MiniMax-M3`（若 Key 可用）仍为绿勾+延迟。「从 API 获取模型」行为与改前一致。

---

### Task 4: 自测命令

```bash
cd desktop && npx vitest run tests/model-health.test.ts
cd desktop && npx tsc -p electron/tsconfig.json --noEmit
```

（可选）完全重启 `npm run dev` 后在设置页对 MOMA 跑批量健康检查肉眼验收。

## no-scope-creep

只改上述文件与类型。禁止改 chat 发送链路、LiteLLM provider、fetch-models 过滤、Enterprise。
