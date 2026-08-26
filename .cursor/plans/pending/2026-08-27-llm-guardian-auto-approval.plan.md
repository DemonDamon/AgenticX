# LLM Guardian：把「按需确认」从写死规则升级为模型代审

Planned-with: Claude Opus 5
Suggested-Impl-Model: `gpt-5.6-sol-medium`（跨前后端、涉及审批判定与 fail-closed 语义，属高风险收口；纯前端展示部分可交 `composer-2.5-fast`）

> 实施前把本文件移到 `.cursor/plans/` 根目录，再从 `origin/main` 开分支。

---

## 0. 背景与动机（不要依赖对话记忆）

### 现状

Desktop 的运行模式有三档，词表唯一来源是
`desktop/src/constants/confirm-strategy-options.ts` 的 `RUN_MODE_OPTIONS`：

| `RunMode` | 标签 | 当前行为 |
|---|---|---|
| `ask` | 始终询问 | 每一步都弹确认卡 |
| `allowlist` | 按需确认 | **规则分级**：`low` / `non_whitelisted` 直接放行，其余弹卡 |
| `auto` | 全部允许 | 不再弹卡（后端沙箱与路径拒绝仍生效） |

「按需确认」的判定在 `desktop/src/utils/confirm-scope.ts`：

```ts
export function shouldAutoApproveConfirm(strategy, _scopeAlreadyAllowed, context) {
  const mode = normalizeRunMode(strategy);
  if (mode === "ask") return false;
  if (mode === "auto") return true;
  return canReuseConfirmPolicy(context);   // low | non_whitelisted，且不含 NEVER_REUSABLE_CATEGORIES
}
```

风险等级由后端给出：`agenticx/runtime/confirm.py`（`normalize_confirm_risk`，只有
`risk == "low"` 可自动放行，其余 fail-closed 为 protected），命令侧分级在
`agenticx/runtime/command_safety.py`，`bash_exec` 的判定入口是
`agenticx/cli/agent_tools.py` 的 `_bash_exec_safety_confirm`。

### 问题

规则分级只认识**枚举内**的风险档。一条既不在只读名单、又没命中危险模式的命令，
统一落成 `non_whitelisted`，于是「按需确认」要么全放（当前行为，可能放过真危险的组合命令），
要么全拦（回到「始终询问」）。规则表列不全命令空间，这是结构性上限，不是补几条正则能解决的。

### 参考

Trae Work 的三档权限里，中间档「自动审批」是**由内置 LLM Guardian 判断是否放行**，
危险命令仍然硬拦（不交给模型）。见 <https://docs.trae.cn/work_permission-and-approval>。
本 plan 借鉴这一机制，但**不**照抄它的其余设计：

- 不照抄「自定义 = 让用户手改 `global.json`」。我们已有 GUI（安全中心的路径规则 / 拒绝命令 / 拒绝工具，走 `/api/permissions`），运行模式菜单底部已加「自定义…」入口跳转过去。
- 不照抄「权限档位捆绑沙箱开关」。我们的审批与工作区隔离是两个独立控件，保持分离。

---

## In scope / Out of scope

### In scope

- 后端新增 Guardian 判定服务：给定 confirm context 返回 `allow` / `deny` / `escalate`
- 「按需确认」档在 Guardian 可用时改走 Guardian，不可用时**回退到现有规则分级**
- Guardian 判定结果在确认卡与工具卡上可见（谁批的、理由是什么）
- Guardian 的开关、模型选择、超时配置落到 `~/.agenticx/config.yaml` 与安全中心 GUI

### Out of scope（严禁顺手做）

- **禁止**让 Guardian 参与 `NEVER_REUSABLE_CATEGORIES`（`destructive_filesystem` /
  `external_publish` / `host_full_access` / `system_disruption`）的判定——这几类永远硬拦，
  永远只能用户逐次确认。模型不得有权放行它们。
- **禁止**改动 `ask` 与 `auto` 两档的语义
- **禁止**碰后端沙箱层（`agenticx/runtime/command_sandbox.py`）
- **禁止**碰 `enterprise/`
- **禁止**顺手重构 `agenticx/cli/agent_tools.py` 的其它工具分支

---

## Task 1：后端 Guardian 判定服务

**新增：** `agenticx/runtime/guardian.py`

```python
GuardianVerdict = Literal["allow", "deny", "escalate"]

@dataclass
class GuardianDecision:
    verdict: GuardianVerdict
    reason: str          # 一句话中文，直接展示给用户
    model: str           # 实际使用的模型名，便于审计
    latency_ms: int
```

```python
async def review_confirm_request(
    context: dict,
    *,
    config: GuardianConfig,
) -> GuardianDecision: ...
```

判定纪律（**必须**按此顺序，先硬规则后模型）：

1. `hasNeverReusableCategory` 对应的后端集合命中 → 直接返回 `escalate`，**不调模型**
2. `risk == "low"` → 直接 `allow`，**不调模型**（省一次调用）
3. 其余情况才把 `tool` / `command` / `path` / `workspace_root` / `risk` 交给模型
4. 模型超时、报错、返回不可解析 → 返回 `escalate`（fail-closed，绝不 fail-open）

提示词要求：只输出 `{"verdict": "...", "reason": "..."}`，`reason` 用中文一句话说明依据。
模型默认复用当前会话的 provider/model，可在配置里单独指定。

### AC-1

新增 `tests/test_guardian_decision.py`：

1. `risk_categories` 含 `destructive_filesystem` → `escalate`，且断言模型客户端**零次调用**（用 mock 计数）
2. `risk == "low"` → `allow`，同样零次调用
3. 模型返回 `{"verdict":"allow","reason":"只读列目录"}` → `allow`，`reason` 透传
4. 模型抛超时 → `escalate`，`reason` 非空
5. 模型返回非 JSON 垃圾 → `escalate`，不抛异常

```bash
pytest tests/test_guardian_decision.py -q
```

---

## Task 2：接入确认链路

**改：** `agenticx/studio/server.py` 的 confirm 派发处、`agenticx/cli/agent_tools.py`
的 `_bash_exec_safety_confirm` 调用点。

- 运行模式为 `allowlist` 且 Guardian 开启时：先问 Guardian
  - `allow` → 不弹卡，直接执行；在工具卡上标注「已由安全审查放行：<reason>」
  - `deny` → 不执行，向模型返回被拒原因（不弹卡打扰用户）
  - `escalate` → 照常弹确认卡，卡上带 Guardian 的理由
- Guardian 关闭或不可用 → 完全回退到现有 `canReuseConfirmPolicy` 规则分级，行为与今天一致

`context` 新增字段（前端要读）：`guardian_verdict`、`guardian_reason`、`guardian_model`。

### AC-2

新增 `tests/test_guardian_confirm_flow.py`：

1. Guardian 关闭时，`allowlist` 档的判定结果与改动前逐字一致（回归护栏）
2. Guardian 返回 `allow` 时不产生 confirm 事件
3. Guardian 返回 `escalate` 时产生 confirm 事件，且 `context["guardian_reason"]` 非空
4. Guardian 返回 `deny` 时工具返回体含拒绝原因，且不产生 confirm 事件

---

## Task 3：前端展示与配置

**改：**
- `desktop/src/utils/confirm-scope.ts`：读 `guardian_verdict`，`escalate` 时照常弹卡
- `desktop/src/components/ConfirmDialog.tsx`：卡片顶部展示「安全审查：<reason>」
- `desktop/src/components/ToolCallCard.tsx`：被 Guardian 放行的工具标注来源
- `desktop/src/components/settings/security/SecurityCenterTab.tsx`：新增 Guardian 开关 +
  模型选择 + 超时，写 `~/.agenticx/config.yaml` 的 `guardian:` 节
- `desktop/src/constants/confirm-strategy-options.ts`：`allowlist` 的 description 在
  Guardian 开启时应体现「由安全审查判断」——**注意这是唯一词表，改这里会同时影响
  底栏 pill、设置页下拉、确认卡文案，改完必须跑全量前端测试**

### AC-3

`desktop/src/utils/confirm-scope.test.ts` 与 `ConfirmDialog.test.tsx` 补：

1. `guardian_verdict: "escalate"` → `shouldAutoApproveConfirm("allowlist", ...)` 为 `false`
2. `guardian_verdict: "allow"` → 为 `true`
3. context 无 `guardian_*` 字段时，判定结果与现状一致（回归护栏）
4. `ConfirmDialog` 在 `guardian_reason` 存在时渲染该理由

```bash
cd desktop && npx vitest run src
```

---

## 验收门槛

- `pytest tests/test_guardian_decision.py tests/test_guardian_confirm_flow.py -q` 全绿
- `cd desktop && npx vitest run src` 全绿（当前基线 895 条）
- `cd desktop && npx tsc --noEmit -p tsconfig.json` 的 error 计数不高于改动前（当前基线 96，均为既有问题）
- 手动冒烟：Guardian 关闭时，「按需确认」档跑 `open .` 的行为与本 plan 实施前一致

---

## 风险

| 风险 | 处理 |
|---|---|
| 模型判定慢，拖住每次工具调用 | 默认超时 3s，超时即 `escalate`；`low` 与永不可复用类别不调模型 |
| 模型被 prompt 注入骗过 | 永不可复用类别根本不进模型；Guardian 只能在规则允许的空间内收紧，不能放宽 |
| 额外 token 成本 | 只在 `allowlist` 档且非 `low` 时调用；配置里可关 |
| 用户不知道是谁批的 | 工具卡与确认卡都标注来源与理由 |
