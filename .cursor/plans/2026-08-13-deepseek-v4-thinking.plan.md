# DeepSeek V4 思考模式与模型介绍 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Composer 2.5（复用窗格 `reasoning_effort` 通道 + 官网 `thinking` extra_body，无跨栈一致性风险；hover 卡只需在现有 Kimi 强度行旁加开关）

**Goal:** 模型选择 hover 卡对 `deepseek-v4-flash` / `deepseek-v4-pro`（及 `deepseek-v4-*` 日期后缀）提供思考模式开关 + 思考强度「高 / 超高」，介绍文案改为「DeepSeek 旗舰模型，支持 1M 上下文窗口」，请求按官网 Chat Completions 传入 `thinking` 与 `reasoning_effort`。

**Architecture:** 不新开 HTTP 客户端。前端在现有 `PaneModelPicker` hover 卡上按 SKU 分叉 UI；`POST /api/chat` 增加可选 `thinking_enabled`，复用已有 `reasoning_effort`。`agent_runtime` 在 LiteLLM kwargs 上合并 `extra_body.thinking` 与顶层 `reasoning_effort`。默认与官网一致：思考开、强度 `high`。

**Tech Stack:** Desktop React hover 卡 + Zustand pane 持久化；Studio `ChatRequest`；`agent_runtime` kwargs 合并。

---

## In scope / Out of scope

**In scope**

- `deepseek-v4-flash` 与 `deepseek-v4-pro`（含 `deepseek-v4-pro-0813` 这类前缀 SKU）同一套思考 UI
- 思考模式开关 + 强度「高」(high) / 「超高」(max)
- hover 介绍：「DeepSeek 旗舰模型，支持 1M 上下文窗口」
- 按窗格持久化 `thinkingEnabled` + `reasoningEffort`
- 后端把开关/强度打进官网 Chat Completions

**Out of scope（禁止顺手做）**

- 不要把 WorkBuddy 的 0.05x / 0.13x 消耗倍率写进 hover（现有规则：`metaLabel` 只展示服务渠道）
- 不要改 Kimi K3 的「低 / 高 / 最大」三档，也不要把 Kimi 的 `low` 暴露给 DeepSeek
- 不要接 Responses API / Anthropic `output_config` / `reasoning.effort=none`
- 不要改 `agent_runtime` 的 `<think>` / `reasoning_content` 解析
- 不要改 `server.py` 顶部 import 区
- Enterprise 厂商表、FIM、Lite 模式 `ChatView` 模型选择器（当前思考 UI 只在 `ChatPane`）

---

## 根因与证据（实施者勿依赖对话）

官网 [思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)：

- OpenAI Chat Completions：**开关** `extra_body={"thinking": {"type": "enabled"|"disabled"}}`；**强度** 顶层 `reasoning_effort="low"|"high"|"max"`
- 默认：思考打开，effort=`high`
- `deepseek-v4-flash` 与 `deepseek-v4-pro` 映射表相同；产品 UI 只暴露官网主推的 **high / max**（文案「高 / 超高」）
- SDK 示例：`reasoning_effort="high"` + `extra_body={"thinking": {"type": "enabled"}}`

现有 Kimi K3 通道（只做对照，禁止把 DeepSeek 塞进该函数）：

- 前端 `desktop/src/utils/model-hover-blurb.ts` `supportsKimiK3ReasoningEffort` → hover 卡「思考强度」
- `ChatPane.tsx` 约 L8980 仅当 K3 时写 `body.reasoning_effort`
- `server.py` 约 L2772–2781 把 `low|high|max` 写入 `session._reasoning_effort`，缺省则清除
- `agent_runtime._kimi_k3_reasoning_effort_kwargs`（约 L926）只认 `kimi-k3*`

DeepSeek 需要额外的 `thinking.type`，且默认开思考；K3 没有总开关。因此 **新建** `_deepseek_v4_thinking_kwargs`，不要改 Kimi 函数签名去兼容。

---

## 数据契约（写死）

| 项 | 值 |
|---|---|
| 命中模型 | bare id 以 `deepseek-v4` 开头（`deepseek-v4-pro`、`deepseek-v4-flash`、`deepseek-v4-pro-0813`） |
| 默认思考 | 开（`thinkingEnabled` 缺省 / `undefined` = true） |
| 默认强度 | `high`（文案「高」） |
| 强度枚举 | `high` → 「高」；`max` → 「超高」 |
| 关闭思考 | `extra_body={"thinking":{"type":"disabled"}}`，**不传** `reasoning_effort` |
| 打开思考 | `reasoning_effort="high"|"max"` + `extra_body={"thinking":{"type":"enabled"}}` |
| Chat body | `thinking_enabled?: boolean`；`reasoning_effort?: "high"|"max"`（K3 仍为 `low\|high\|max`） |
| hover 介绍 | `DeepSeek 旗舰模型，支持 1M 上下文窗口`（Flash / Pro 同一句） |
| hover meta | 仍为「服务渠道」+ 厂商名，禁止 `0.05x` 类倍率 |

`POST /api/chat` 示例（思考开、超高）：

```json
{
  "session_id": "...",
  "user_input": "...",
  "provider": "deepseek",
  "model": "deepseek-v4-flash",
  "thinking_enabled": true,
  "reasoning_effort": "max"
}
```

思考关：

```json
{
  "thinking_enabled": false
}
```

---

## 子规划 → 推荐模型

| 子规划 | 推荐模型 | 理由 |
|---|---|---|
| 后端 kwargs + ChatRequest | Composer 2.5 | 对照 Kimi 薄接线 |
| hover 卡 UI + 持久化 | Composer 2.5 | 在现有 Kimi 强度行旁加开关，无视觉重塑 |
| 单测 | Composer 2.5 | 纯断言 |

---

### Task 1: 后端 DeepSeek V4 kwargs

**Files:**
- Modify: `agenticx/runtime/agent_runtime.py`（`_kimi_k3_reasoning_effort_kwargs` 之后约 L938；调用点约 L3513）
- Modify: `agenticx/studio/protocols.py` `ChatRequest` 约 L58–59
- Modify: `agenticx/studio/server.py` 约 L2772–2781（只改这段，禁止碰文件顶部 import）
- Test: `tests/test_deepseek_v4_thinking.py`（新建）

**Step 1: 写失败测试**

`tests/test_deepseek_v4_thinking.py`：

```python
from types import SimpleNamespace
from agenticx.runtime.agent_runtime import _deepseek_v4_thinking_kwargs

def test_enabled_high_default():
    session = SimpleNamespace()
    out = _deepseek_v4_thinking_kwargs(session, "deepseek-v4-flash")
    assert out["reasoning_effort"] == "high"
    assert out["extra_body"]["thinking"] == {"type": "enabled"}
    assert _deepseek_v4_thinking_kwargs(session, "openai/deepseek-v4-pro")["reasoning_effort"] == "high"
    assert _deepseek_v4_thinking_kwargs(session, "deepseek-v4-pro-0813")["extra_body"]["thinking"]["type"] == "enabled"

def test_max_effort():
    session = SimpleNamespace(_thinking_enabled=True, _reasoning_effort="max")
    assert _deepseek_v4_thinking_kwargs(session, "deepseek-v4-pro")["reasoning_effort"] == "max"

def test_disabled_omits_effort():
    session = SimpleNamespace(_thinking_enabled=False, _reasoning_effort="max")
    out = _deepseek_v4_thinking_kwargs(session, "deepseek-v4-flash")
    assert "reasoning_effort" not in out
    assert out["extra_body"]["thinking"] == {"type": "disabled"}

def test_ignored_for_other_models():
    session = SimpleNamespace(_thinking_enabled=True, _reasoning_effort="max")
    assert _deepseek_v4_thinking_kwargs(session, "kimi-k3") == {}
    assert _deepseek_v4_thinking_kwargs(session, "deepseek-chat") == {}

def test_invalid_effort_falls_back_to_high():
    session = SimpleNamespace(_thinking_enabled=True, _reasoning_effort="low")
    assert _deepseek_v4_thinking_kwargs(session, "deepseek-v4-pro")["reasoning_effort"] == "high"
```

**Step 2: 实现 `_deepseek_v4_thinking_kwargs`**

在 `_kimi_k3_reasoning_effort_kwargs` 后新增（不要改 Kimi 函数）：

```python
def _is_deepseek_v4_model(model_name: str) -> bool:
    bare = str(model_name or "").strip().lower().split("/")[-1]
    return bare.startswith("deepseek-v4")


def _deepseek_v4_thinking_kwargs(session: Any, model_name: str) -> Dict[str, Any]:
    """OpenAI-compat DeepSeek V4: extra_body.thinking + optional reasoning_effort."""
    if not _is_deepseek_v4_model(model_name):
        return {}
    enabled = getattr(session, "_thinking_enabled", None)
    if enabled is False:
        return {"extra_body": {"thinking": {"type": "disabled"}}}
    raw = str(getattr(session, "_reasoning_effort", "") or "").strip().lower()
    effort = raw if raw in {"high", "max"} else "high"
    return {
        "reasoning_effort": effort,
        "extra_body": {"thinking": {"type": "enabled"}},
    }


def _merge_llm_call_kwargs(base: Dict[str, Any], extra: Dict[str, Any]) -> None:
    """Update call kwargs; merge extra_body instead of replacing prompt-cache extra_body."""
    payload = dict(extra or {})
    extra_body = payload.pop("extra_body", None)
    base.update(payload)
    if isinstance(extra_body, dict):
        existing = base.get("extra_body")
        merged = dict(existing) if isinstance(existing, dict) else {}
        merged.update(extra_body)
        base["extra_body"] = merged
```

调用点约 L3513 **before:**

```python
llm_call_kwargs.update(
    _kimi_k3_reasoning_effort_kwargs(session, model_name)
)
```

**after:**

```python
_merge_llm_call_kwargs(
    llm_call_kwargs,
    _kimi_k3_reasoning_effort_kwargs(session, model_name),
)
_merge_llm_call_kwargs(
    llm_call_kwargs,
    _deepseek_v4_thinking_kwargs(session, model_name),
)
```

`ChatRequest` 在 `reasoning_effort` 旁增加：

```python
# DeepSeek V4 thinking switch; None = leave unset (runtime defaults on for V4).
thinking_enabled: Optional[bool] = None
```

`server.py` L2772 段 **after**（精确增行，勿整段覆盖 import）：

```python
_effort = str(getattr(payload, "reasoning_effort", None) or "").strip().lower()
if _effort in {"low", "high", "max"}:
    setattr(session, "_reasoning_effort", _effort)
elif hasattr(session, "_reasoning_effort"):
    try:
        delattr(session, "_reasoning_effort")
    except Exception:
        setattr(session, "_reasoning_effort", None)

_thinking = getattr(payload, "thinking_enabled", None)
if _thinking is True or _thinking is False:
    setattr(session, "_thinking_enabled", bool(_thinking))
elif hasattr(session, "_thinking_enabled"):
    try:
        delattr(session, "_thinking_enabled")
    except Exception:
        setattr(session, "_thinking_enabled", None)
```

**Step 3:** `python -m pytest tests/test_deepseek_v4_thinking.py tests/test_kimi_k3_reasoning_effort.py -q`

---

### Task 2: hover 介绍 + 思考 UI + 请求体

**Files:**
- Modify: `desktop/src/utils/model-hover-blurb.ts`
- Modify: `desktop/src/utils/model-hover-blurb.test.ts`
- Modify: `desktop/src/store.ts`（`ChatPane.thinkingEnabled`、`setPaneThinkingEnabled`）
- Modify: `desktop/src/App.tsx`（persist/hydrate `thinkingEnabled`）
- Modify: `desktop/src/components/ChatPane.tsx`（hover 卡 + POST body）
- Reuse: `desktop/src/components/settings/SettingsSwitch.tsx` `size="sm"`

**`model-hover-blurb.ts`**

- `supportsDeepSeekV4Thinking(model)`：`normalizeBareModelId(model).toLowerCase().startsWith("deepseek-v4")`
- `DeepSeekReasoningEffort = "high" | "max"`
- `DEEPSEEK_REASONING_EFFORT_OPTIONS = [{value:"high",label:"高"},{value:"max",label:"超高"}]`
- `DEFAULT_DEEPSEEK_REASONING_EFFORT = "high"`
- `normalizeDeepSeekReasoningEffort`：仅 `high`/`max`，其余回落 `high`
- `ModelHoverBlurb.supportsDeepSeekThinking: boolean`
- `describeModelForPicker` 设置 `supportsDeepSeekThinking: supportsDeepSeekV4Thinking(model)`
- 把现有两条 V4 curated 规则合成一条，description 固定为 `DeepSeek 旗舰模型，支持 1M 上下文窗口`

**store.ts**

```ts
thinkingEnabled?: boolean; // undefined = default on for DeepSeek V4
setPaneThinkingEnabled: (paneId: string, enabled: boolean) => void;
```

实现对照 `setPaneReasoningEffort`，只改目标 pane。

**App.tsx**

- `PersistedPaneState.thinkingEnabled?: boolean`
- hydrate：`typeof row.thinkingEnabled === "boolean" ? row.thinkingEnabled : undefined`
- persist：`thinkingEnabled: pane.thinkingEnabled`

**ChatPane `PaneModelPicker` hover 卡（约 L1497）**

当 `hoverBlurb.supportsDeepSeekThinking`：

1. 一行「思考模式」+ `SettingsSwitch size="sm"`，`checked={pane.thinkingEnabled !== false}`
2. 开关打开后才渲染「思考强度」行，选项仅 高/超高；当前值 `normalizeDeepSeekReasoningEffort(pane.reasoningEffort)`
3. 关掉思考时收起强度菜单

Kimi 分支保持 `supportsReasoningEffort` 原样（低/高/最大，无总开关）。

`tipH`：DeepSeek 开思考且菜单展开约 220；开思考收起约 168；关思考约 140；Kimi 维持 196/148；无控件 108。

**发送（约 L8980）after:**

```ts
if (chatModel && supportsKimiK3ReasoningEffort(chatModel)) {
  body.reasoning_effort = normalizeKimiReasoningEffort(
    pane.reasoningEffort ?? DEFAULT_KIMI_REASONING_EFFORT,
  );
} else if (chatModel && supportsDeepSeekV4Thinking(chatModel)) {
  const thinkingOn = pane.thinkingEnabled !== false;
  body.thinking_enabled = thinkingOn;
  if (thinkingOn) {
    body.reasoning_effort = normalizeDeepSeekReasoningEffort(pane.reasoningEffort);
  }
}
```

**测试** `model-hover-blurb.test.ts`：

- flash/pro 介绍含 `1M` 与 `旗舰`，`supportsDeepSeekThinking === true`，`supportsReasoningEffort === false`
- `normalizeDeepSeekReasoningEffort("max")==="max"`，`"low"==="high"`
- 仍断言 hover JSON 不含 `\d+x` 倍率

---

## AC

- AC-1: hover `deepseek-v4-flash` 与 `deepseek-v4-pro` 介绍均为「DeepSeek 旗舰模型，支持 1M 上下文窗口」，无消耗倍率
- AC-2: 两模型均可开关思考；开时可选「高」「超高」；默认开 + 高
- AC-3: 思考开且超高 → kwargs `reasoning_effort=max` + `thinking.type=enabled`
- AC-4: 思考关 → 仅 `thinking.type=disabled`，无 `reasoning_effort`
- AC-5: `kimi-k3` / `deepseek-chat` 不受 DeepSeek helper 影响
- AC-6: `tests/test_kimi_k3_reasoning_effort.py` 仍绿
