# DeepSeek 原生厂商（设置侧栏）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Composer 2.5（内置厂商清单接线 + MiniMax/智谱同款薄 OpenAI 兼容 provider，无跨栈一致性风险、无需审美重塑）

**Goal:** 让 Near 桌面端「设置 → 模型服务」侧栏出现独立的 **DeepSeek** 条目（与 MiniMax / 月之暗面同级），填 Key 后可拉模型、聊天走官网 `https://api.deepseek.com`。

**Architecture:** 不写第二套 HTTP 客户端。新增薄封装 `DeepSeekProvider(LiteLLMProvider)`，默认 `base_url=https://api.deepseek.com/v1`，模型 id 归一成 `openai/<bare>` 以免 LiteLLM 把 `deepseek/` 前缀当成自家路由、丢掉自定义 base。桌面把 `deepseek` 加入内置厂商清单、默认地址、展示名与已有 `ProviderIcon` 的 deepseek 字形对齐。

**Tech Stack:** Python `LiteLLMProvider` 子类；Desktop React Settings + Electron `KNOWN_BASE_URLS`；现有 `/models` 拉取。

---

## In scope / Out of scope

**In scope**

- 设置侧栏内置厂商 `deepseek`，展示名「DeepSeek」，不可删除
- 默认 API 地址 `https://api.deepseek.com/v1`；密钥环境变量 `DEEPSEEK_API_KEY`
- 默认 / fallback 模型：`deepseek-v4-pro`、`deepseek-v4-flash`（官网现网 Chat Completions 示例名）
- `ProviderResolver` / `ConfigManager` / `LlmFactory` / 前后端展示名同步
- 冒烟：resolver 默认 URL + `openai/` 前缀；前端 `getProviderDisplayName("deepseek")=="DeepSeek"` 且不可删

**Out of scope（禁止顺手做）**

- 思考开关 / `reasoning_effort` UI（Kimi K3 那套不要复用到 DeepSeek）
- FIM、对话前缀续写、Responses API、`strict` tool schema、Anthropic 兼容入口
- JSON Output 作为聊天模式；记忆图谱 `json_compat` 白名单
- 改 `agent_runtime.py` 工具回传 / `<think>` 解析（现有 LiteLLM 流式路径已吃 `reasoning_content`）
- Enterprise admin-console / web-portal 厂商表
- 官网文档 `AgenticX-Website`、改 `server.py` import 区

---

## 根因与证据（实施者勿依赖对话）

设置侧栏只渲染 `ALL_PROVIDERS` + 用户「+ 添加」的自定义项：

```198:201:desktop/src/components/SettingsPanel.tsx
const ALL_PROVIDERS = [
  "openai", "anthropic", "volcengine", "bailian",
  "zhipu", "qianfan", "minimax", "kimi", "ollama",
] as const;
```

`ProviderResolver.PROVIDER_MAP`（`agenticx/llms/provider_resolver.py` L29–40）没有 `deepseek`。未登记的 key 只有 `extra.interface=openai` 或 `custom_openai_*` 才会走 LiteLLM。

`ProviderIcon.tsx` 已有 `IconDeepseek` 与 `p.includes("deepseek")` 解析；侧栏缺的是清单 id，不是图标。

官网 Chat Completions：`base_url="https://api.deepseek.com"`，模型示例 `deepseek-v4-pro` / `deepseek-v4-flash`。Electron `resolveOpenAiCompatApiBase` 会给无 `/vN` 的地址补 `/v1`，因此配置里存 `https://api.deepseek.com/v1`，与 MiniMax / Kimi 一致。

对照薄封装：`agenticx/llms/minimax_provider.py`、`agenticx/llms/zhipu_provider.py`（`openai/` 前缀 + 默认 base）。

---

## 数据契约（写死）

| 项 | 值 |
|---|---|
| 配置 key | `deepseek` |
| 展示名 | `DeepSeek` |
| 默认 `base_url` | `https://api.deepseek.com/v1` |
| 默认模型 | `deepseek-v4-pro` |
| 环境变量 | `DEEPSEEK_API_KEY` |
| LiteLLM 模型 | 裸 id `deepseek-v4-pro` → `openai/deepseek-v4-pro`；已是 `openai/...` 则不重复加；若带 `deepseek/` 前缀则剥掉再加 `openai/` |
| 品牌色 | `#4d6bfe`（已有 `ProviderIcon` `resolveProviderVisualBrand`） |

`~/.agenticx/config.yaml` 启用后形态：

```yaml
providers:
  deepseek:
    api_key: "sk-..."
    base_url: "https://api.deepseek.com/v1"   # 可留空，resolver/Electron 用默认
    model: "deepseek-v4-pro"
    models: ["deepseek-v4-pro", "deepseek-v4-flash"]
    enabled: true
```

---

## 子规划 → 推荐模型

| 子规划 | 推荐模型 | 理由 |
|---|---|---|
| 全文（本 plan 全部 Task） | Composer 2.5 | 复制 MiniMax/智谱清单接线，无新协议、无视觉重塑 |

Suggested-Impl-Model: Composer 2.5

---

### Task 1: Resolver 冒烟测试（先写失败用例）

**Files:**
- Modify: `tests/test_llm_provider_resolver.py`
- Modify: `tests/test_provider_display.py`
- Modify: `desktop/src/utils/model-display.test.ts`

**Step 1: 在 `test_llm_provider_resolver.py` 追加**

```python
from agenticx.llms.deepseek_provider import DeepSeekProvider

def test_resolver_uses_deepseek_default_base_url(tmp_path: Path, monkeypatch):
    _setup_paths(tmp_path, monkeypatch)
    ConfigManager.set_value("default_provider", "deepseek", scope="global")
    ConfigManager.set_value("providers.deepseek.api_key", "ds-key", scope="global")
    ConfigManager.set_value("providers.deepseek.model", "deepseek-v4-pro", scope="global")

    provider = ProviderResolver.resolve()
    assert isinstance(provider, DeepSeekProvider)
    assert provider.base_url == "https://api.deepseek.com/v1"
    assert provider.model == "openai/deepseek-v4-pro"


def test_deepseek_provider_strips_deepseek_prefix():
    provider = DeepSeekProvider.from_config({"model": "deepseek/deepseek-v4-flash", "api_key": "k"})
    assert provider.model == "openai/deepseek-v4-flash"
    assert provider.base_url == "https://api.deepseek.com/v1"


def test_deepseek_provider_idempotent_openai_prefix():
    provider = DeepSeekProvider.from_config({"model": "openai/deepseek-v4-pro", "api_key": "k"})
    assert provider.model == "openai/deepseek-v4-pro"
```

**Step 2: `test_provider_display.py` 追加**

```python
assert get_provider_display_name("deepseek") == "DeepSeek"
```

放进 `test_get_provider_display_name_hides_raw_custom_ids` 或新 test。

**Step 3: `model-display.test.ts` 追加**

```ts
expect(getProviderDisplayName("deepseek", {})).toBe("DeepSeek");
expect(isProviderDeletable("deepseek")).toBe(false);
expect(isProviderDisplayNameEditable("deepseek", {})).toBe(false);
```

**Step 4: 跑测确认失败**

```
python -m pytest tests/test_llm_provider_resolver.py::test_resolver_uses_deepseek_default_base_url -q
```

Expected: `ModuleNotFoundError` 或 `Unsupported provider: deepseek`。

---

### Task 2: `DeepSeekProvider` 薄封装

**Files:**
- Create: `agenticx/llms/deepseek_provider.py`
- Modify: `agenticx/llms/provider_resolver.py`（`PROVIDER_MAP`）
- Modify: `agenticx/llms/__init__.py`
- Modify: `agenticx/llms/llm_factory.py`

**实现要点（对齐 `zhipu_provider.py` 的 `from_config` + 前缀归一，不要抄智谱的 `drop_params=True` 强制）：**

```python
#!/usr/bin/env python3
"""DeepSeek provider using OpenAI-compatible API.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from pydantic import Field, model_validator  # type: ignore

from .litellm_provider import LiteLLMProvider

_DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"
_DEFAULT_MODEL = "deepseek-v4-pro"


def _normalize_litellm_model_for_deepseek(raw_model: str) -> str:
    name = str(raw_model or "").strip() or _DEFAULT_MODEL
    if "/" in name:
        prefix, rest = name.split("/", 1)
        if prefix.lower() in ("deepseek", "openai") and rest.strip():
            name = rest.strip()
    if not name:
        name = _DEFAULT_MODEL
    if name.lower().startswith("openai/"):
        return name
    return f"openai/{name}"


class DeepSeekProvider(LiteLLMProvider):
    """LLM provider for DeepSeek official OpenAI-compatible API."""

    @model_validator(mode="after")
    def _normalize_deepseek_config(self) -> "DeepSeekProvider":
        self.base_url = (self.base_url or "").strip() or _DEFAULT_DEEPSEEK_BASE_URL
        if self.model:
            self.model = _normalize_litellm_model_for_deepseek(self.model)
        return self

    @classmethod
    def from_config(cls, config: Dict[str, Any]) -> "DeepSeekProvider":
        return cls(
            model=_normalize_litellm_model_for_deepseek(str(config.get("model") or _DEFAULT_MODEL)),
            api_key=config.get("api_key"),
            base_url=config.get("base_url") or _DEFAULT_DEEPSEEK_BASE_URL,
            timeout=config.get("timeout"),
            max_retries=config.get("max_retries"),
            drop_params=config.get("drop_params"),
            extra_body=config.get("extra_body") if isinstance(config.get("extra_body"), dict) else None,
        )
```

`provider_resolver.py` `PROVIDER_MAP` 增加 `"deepseek": DeepSeekProvider`（import 该 class）。

`__init__.py`：try 块 import `DeepSeekProvider`，`__all__` 增加名字；失败时 `DeepSeekProvider = None`。

`llm_factory.py`：在 `minimax` 分支旁加 `elif llm_type == "deepseek": return DeepSeekProvider(...)`。

**不要**改 `provider_resolver._normalized_model` 去给 `deepseek` 加 LiteLLM 原生 `deepseek/` 前缀——必须走 `openai/` + 官方 base。

---

### Task 3: 配置与展示名

**Files:**
- Modify: `agenticx/cli/config_manager.py` L17–53 `SUPPORTED_PROVIDERS` / `ENV_PROVIDER_MAP`
- Modify: `agenticx/llms/provider_display.py` `BUILTIN_PROVIDER_DISPLAY_NAMES`
- Modify: `agenticx/studio/server.py` **仅** `_resolve_llm` 里 fallback 候选列表（约 L2809–2818）追加 `"deepseek"`。**禁止整段替换 import 区或相邻无关行。**

```python
# config_manager.py
"deepseek": {"required": ["api_key"], "default_model": "deepseek-v4-pro"},
# ENV_PROVIDER_MAP
"deepseek": ("DEEPSEEK_API_KEY", "deepseek-v4-pro"),
```

```python
# provider_display.py
"deepseek": "DeepSeek",
```

改完 `server.py` 后按仓库规则做一次冷启动 smoke（见 Task 6）。

---

### Task 4: Desktop 设置侧栏

**Files:**
- Modify: `desktop/src/components/SettingsPanel.tsx` `ALL_PROVIDERS`：在 `"kimi"` 与 `"ollama"` 之间插入 `"deepseek"`
- Modify: `desktop/src/utils/provider-display.ts`
  - `PROVIDER_BRAND_COLOR.deepseek = "#4d6bfe"`
  - `BUILTIN_PROVIDER_IDS` 加 `"deepseek"`
  - `PROVIDER_DISPLAY_NAME.deepseek = "DeepSeek"`
- Modify: `desktop/electron/main.ts`
  - `KNOWN_BASE_URLS.deepseek = "https://api.deepseek.com/v1"`
  - `PROVIDER_FALLBACK_MODELS.deepseek = ["deepseek-v4-pro", "deepseek-v4-flash"]`（`/models` 404 时兜底，与 MiniMax 同机制）

侧栏已用 `ProviderIcon provider={name}`；`resolveProviderVisualKey` 已识别 `deepseek`，**不必改** `ProviderIcon.tsx`。

`DROP_PARAMS_CAPABLE_PROVIDERS` **不要**加 deepseek（官方会静默忽略未知参数，与默认 OpenAI 行为一致）。

---

### Task 5: 模型 picker 文案（仅 DeepSeek 现网 SKU）

**Files:**
- Modify: `desktop/src/utils/model-hover-blurb.ts` `CURATED_BLURBS`：在现有 `deepseek-r1` / `deepseek-chat` 规则**之前**插入：

```ts
{
  test: (m) => m.includes("deepseek-v4-pro") || m === "deepseek-v4-pro",
  description: "官网旗舰对话，适合复杂推理、代码与工具调用",
},
{
  test: (m) => m.includes("deepseek-v4-flash") || m === "deepseek-v4-flash",
  description: "官网快速档，适合日常对话与低延迟任务",
},
```

不要删旧 r1/v3 规则（自定义网关仍可能暴露旧 id）。

可选：`desktop/src/utils/model-hover-blurb.test.ts` 补一条 `describeModelForPicker("deepseek", "deepseek-v4-pro", "DeepSeek")` 含上述 description。

---

### Task 6: 跑测与手工验收

**命令**

```
python -m pytest tests/test_llm_provider_resolver.py tests/test_provider_display.py -q
```

Desktop（在 `desktop/`）：

```
npx vitest run src/utils/model-display.test.ts src/utils/model-hover-blurb.test.ts
```

若改了 `server.py`：临时端口冷启动 `agx serve --host 127.0.0.1 --port <空闲>`，确认 `/api/session`、`/api/avatars`、`/api/sessions` 返回 200。

**手工 AC**

- AC-1: 打开设置 → 模型服务，侧栏在「月之暗面」与「Ollama」之间看到 **DeepSeek**，图标为已有鲸鱼标，状态「未启用」，无「添加」误标。
- AC-2: 选中 DeepSeek，API 地址留空时检测/拉模型走 `https://api.deepseek.com/v1`（预览为 `.../v1/chat/completions`）。
- AC-3: 填官网 Key → 检测成功 →「从 API 获取模型」弹出选择面板（不要自动全选可见）。
- AC-4: 启用后聊天窗格模型列表出现 `DeepSeek/deepseek-v4-pro`（或拉取到的 id）；发一条消息有回复。DeepSeek 条目不可从侧栏删除。
- AC-5: 未改 MiniMax / 月之暗面 / 自定义「彩讯」等已有条目的展示与删除语义。

---

## 实施顺序

1. Task 1 失败测试
2. Task 2 provider + resolver
3. Task 3 配置/展示名/`server.py` 一行
4. Task 4 Desktop 清单
5. Task 5 hover 文案
6. Task 6 测试 + 手工

每个 Task 单独可核验；禁止顺手改思考模式或 `agent_runtime`。
