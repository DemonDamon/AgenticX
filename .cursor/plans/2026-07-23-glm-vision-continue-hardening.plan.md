# GLM 视觉模型附图链路加固（非视觉拦截 + 上游抖动重试 + 真实中断文案）

Planned-with: Opus 4.8
Suggested-Impl-Model: cursor-grok-4.5-high-fast（用户已指定全程用 Grok 4.5 high fast 实施；下方每个 FR 仍标注「够用且省」的性质判据供参考）

> 本 plan 由一次线上排障驱动：用户在 Machi Desktop 用智谱 GLM 模型对一张微信 403 截图提问，反复失败、界面显示「上一步工具执行后未收到模型响应 / 健康度：卡住」，换视觉模型后仍不行。经本机复现，确认是**模型侧上游抖动 + 我方工程侧三个真实缺陷叠加**，且界面文案把 API 400 伪装成「工具后无响应」误导用户。本 plan 从根上修掉工程侧缺陷，并吸收模型侧抖动。
>
> **实施者须知**：本 plan 假设你没有看过本次对话。所有落点均给出「文件绝对路径 + 函数名 + 当前行号 + before/after」。行号以当前 `origin/main` 工作区为准，若与实际有 ±几行偏移，以函数名 + 锚点代码片段为准。

---

## 背景与根因证据链（不依赖对话记忆）

排障会话：`~/.agenticx/sessions/257bcd17-d19c-4b55-aeba-7aa2ede9b2a7/`，附件 `uploads/4eaa17385192c37a.png`（2294×1130 PNG，内容为浏览器 HTTP 403 页面）。

本机直连智谱 `https://open.bigmodel.cn/api/paas/v4/chat/completions` 复现矩阵（api_key 取自 `~/.agenticx/config.yaml` 的 `providers.zhipu.api_key`）：

| 场景 | 模型 | 结果 |
|---|---|---|
| 纯文本消息 + `image_url` 多模态块 | `glm-4.5-air` | `messages.content.type 参数非法，取值范围 ['text']`（**确定性 400**：该 SKU 不支持图片） |
| 同一张图 + 新建会话 | `glm-4.6v` | 成功出 final（约 10s，识别到 HTTP 403） |
| 同一张图 + 多模态 + 全量 62 个工具 | `glm-4.6v` | **时好时坏**：多次为 `code:1210 API 调用参数有误…invalid input`，偶尔 200 |
| 纯文本 + 全量工具（无图） | `glm-4.6v` | 稳定成功 |
| 同图 + 多模态 | `glm-4v-flash` | 成功；但经 Near 运行时（`max_tokens=8192`）→ `max_tokens参数非法：限制数值范围[1,1024]` |
| 污染会话点「恢复执行」 | `glm-4.6v` | **稳定 3–4s 报 `invalid input`** |

失败落盘（`~/.agenticx/memory/sessions.sqlite` 表 `scratchpad`，key `__last_turn_failure__`）：
- air 阶段：`text = "...messages.content.type 参数非法，取值范围 ['text']"`
- 4.6v 阶段：`text = "模型调用失败: litellm.BadRequestError: OpenAIException - API 调用参数有误，请检查文档。invalid input"`，`detector = "unknown"`
- `__continuation_no_progress__.real_tool_count = 0` → **工具从未执行过**，界面「工具后未收到模型响应」文案与事实不符。

**根因分解：**

1. **【工程侧】非视觉 GLM SKU 未被拦截。** `agenticx/llms/vision.py` 的 `is_vision_capable` 只把 `glm-5*` 判为非视觉，`glm-4.5-air`（纯文本）仍被判为 vision-capable → 图片照发 → 上游确定性 400。前端 `desktop/src/utils/model-vision.ts` 同样漏判，附图前不拦截、不提示。

2. **【模型侧抖动 + 工程侧不重试】** 智谱对 `glm-4.6v` 的「多模态 + 工具」请求本身不稳定（同请求时好时坏返回 1210 `invalid input`）。`agenticx/llms/provider_fault.py` 的 `classify_provider_fault` 把 `invalid input` 归为 `unknown` → `agent_runtime.py` 不重试 → 一次抖动即整轮失败。

3. **【工程侧】中断文案不透真因。** `desktop/src/components/messages/TurnInterruptionNoticeLine.tsx` 第 17 行对所有非用户中断硬编码「上一步工具执行后未收到模型响应」，无视 `cause`（本例为 `runtime_failure`）与 `__last_turn_failure__` 的真实错误文本。后端 `agenticx/studio/turn_interruption.py` 生成的 notice 也未携带真实错误摘要。

4. **【工程侧隐患】** `agent_runtime.py` 的 `_zhipu_tool_stream_supported` 前缀表含 `"glm-4.6"`，`"glm-4.6v".startswith("glm-4.6")` 为真 → 视觉模型被误开 `tool_stream`（增量工具调用），与 plan 原意（仅 glm-4.7/5.x）不符。实测非本次 1210 主因，但属同类隐患，一并收口。

5. **【工程侧隐患，可选】** `agent_runtime.py` 流式/invoke 固定 `max_tokens=8192`，`glm-4v-flash` 等低上限 SKU 上限仅 1024，直接 400。

---

## In scope / Out of scope

**In scope（本 plan 修）：**
- FR-1 非视觉 GLM SKU 识别（后端 + 前端对齐）
- FR-2 智谱视觉多模态请求 `invalid input` 一次性重试
- FR-3 中断卡透出真实失败原因（后端 notice + 前端展示）
- FR-4 `tool_stream` 门控排除视觉 SKU
- FR-5（可选 P2）低 `max_tokens` 上限模型自适应降级重试

**Out of scope（严禁顺手改）：**
- 不改 `agenticx/studio/server.py` 顶部 import 区块（该文件极敏感，见 AGENTS.md）；本 plan 不需要动它。
- 不重构 `agent_runtime.py` 的流式主循环结构、`_sanitize_context_messages`、compaction/token budget 逻辑。
- 不改续跑 `continuation.py` 的去重/no-progress/prompt 文案逻辑。
- 不动 minimax / bailian 分支的现有行为（仅在同一函数内平行新增 zhipu 规则，保持其它 provider 不变）。
- 不清理污染会话数据、不迁移历史 `messages.json`。
- 不改 SSE 头、协议 schema、默认模型绑定。

---

## FR 一览

| FR | 优先级 | 主文件 | 性质 → 够用即省判据 |
|---|---|---|---|
| FR-1 非视觉 GLM 识别 | P0 | `vision.py` + `model-vision.ts` | 纯函数 + 正则 + 双端对齐，代码专精便宜档即可 |
| FR-2 invalid input 重试 | P0 | `agent_runtime.py` | 运行时异常路径接线，序列敏感，中档代码模型 |
| FR-3 真实中断文案 | P0 | `turn_interruption.py` + 2 个前端文件 | 后端拼串 + 前端条件渲染，中档 |
| FR-4 tool_stream 门控 | P1 | `agent_runtime.py` | 单函数正则，便宜档 |
| FR-5 max_tokens 自适应 | P2 可选 | `agent_runtime.py` | 异常重试接线，中档 |

---

## FR-1（P0）：把 `glm-4.5-air` 等纯文本 GLM SKU 判为非视觉

### 根因
`agenticx/llms/vision.py` 第 27–36 行 `_zhipu_glm5_family_no_vision` 只覆盖 `glm-5` / `glm-5-*`；`glm-4.5-air`、`glm-4.6`、`glm-4-plus` 等纯文本 SKU 逃逸 → 被判 vision-capable → 附图请求被上游确定性拒绝。

### 设计：智谱视觉模型命名规律
智谱视觉 SKU 名称都带数字+v 视觉标记：`glm-4v`、`glm-4v-flash`、`glm-4.1v-thinking-flash`、`glm-4.5v`、`glm-4.6v`、`glm-4.6v-flash`。纯文本 SKU 不含该标记：`glm-4`、`glm-4-plus`、`glm-4-air/airx/flash/long`、`glm-4.5`、`glm-4.5-air/airx/x/flash`、`glm-4.6`、`glm-5`、`glm-z1*`。

**统一判据（保守：先豁免视觉标记，再匹配已知文本前缀；未知新模型默认放行以免误剥图）：**
1. slug 命中 `\dv | vision | vl`（如 `4v`/`4.1v`/`4.5v`/`4.6v`）→ **视觉**（不拦）。
2. 否则 slug 以 `glm-5` / `glm-4.6` / `glm-4.5` / `glm-4` / `glm-z1` / `glm-zero` 开头 → **纯文本**（拦）。
3. 其它一律放行（返回可视觉），避免误伤未知视觉模型。

### 后端改动
文件：`/Users/damon/myWork/AgenticX/agenticx/llms/vision.py`

**改法**：将 `_zhipu_glm5_family_no_vision`（第 27–36 行）整体替换为 `_zhipu_text_only_family`，并同步更新 `is_vision_capable`（第 57–58 行）对它的调用。**只改这两处，勿动 minimax/bailian 分支。**

Before（第 27–36 行）：
```python
def _zhipu_glm5_family_no_vision(model_name: str) -> bool:
    """GLM-5 chat SKUs on BigModel v4 reject multimodal message parts (image_url)."""
    raw = str(model_name or "").strip().lower()
    if not raw:
        return False
    if "/" in raw:
        raw = raw.rsplit("/", 1)[-1]
    if "vl" in raw or "vision" in raw or "4v" in raw or "5v" in raw:
        return False
    return raw == "glm-5" or raw.startswith("glm-5-")
```

After：
```python
def _zhipu_text_only_family(model_name: str) -> bool:
    """GLM chat SKUs that reject multimodal image_url parts on BigModel v4.

    Zhipu vision SKUs always carry a digit+"v" marker (glm-4v, glm-4.1v,
    glm-4.5v, glm-4.6v, ...). Anything on the known GLM text families without
    that marker rejects image_url and must have images stripped. Unknown model
    names are left vision-capable to avoid wrongly stripping images from a
    future vision SKU.
    """
    raw = str(model_name or "").strip().lower()
    if not raw:
        return False
    if "/" in raw:
        raw = raw.rsplit("/", 1)[-1]
    # Vision marker -> treat as vision-capable (do not strip).
    if re.search(r"\dv|vision|vl", raw):
        return False
    return raw.startswith(("glm-5", "glm-4.6", "glm-4.5", "glm-4", "glm-z1", "glm-zero"))
```

`is_vision_capable`（第 57–58 行）Before：
```python
    if provider == "zhipu" and _zhipu_glm5_family_no_vision(model):
        return False
```
After：
```python
    if provider == "zhipu" and _zhipu_text_only_family(model):
        return False
```

> `re` 已在文件第 9 行 import，无需新增。

### 前端改动（对齐同规则）
文件：`/Users/damon/myWork/AgenticX/desktop/src/utils/model-vision.ts`

将 `zhipuGlm5TextOnlySlug`（第 21–26 行）替换为 `zhipuTextOnlySlug`，并更新第 49 行调用。

Before（第 21–26 行）：
```typescript
/** Zhipu GLM-5 line: text chat only on paas v4; multimodal parts return 400. */
function zhipuGlm5TextOnlySlug(slug: string): boolean {
  const s = slug.toLowerCase();
  if (/vl|vision|4v|5v/.test(s)) return false;
  return s === "glm-5" || /^glm-5([.\-_]|$)/.test(s);
}
```
After：
```typescript
/** Zhipu GLM text SKUs (no digit+"v" vision marker) reject image_url on paas v4. */
function zhipuTextOnlySlug(slug: string): boolean {
  const s = slug.toLowerCase();
  if (/\dv|vision|vl/.test(s)) return false;
  return /^glm-(5|4\.6|4\.5|4|z1|zero)/.test(s);
}
```

第 49 行 Before：
```typescript
  if (p === "zhipu" && zhipuGlm5TextOnlySlug(slug)) return true;
```
After：
```typescript
  if (p === "zhipu" && zhipuTextOnlySlug(slug)) return true;
```

### AC-1
新建/追加 `tests/test_llm_vision.py`（已存在，追加用例），断言矩阵：

| provider | model | is_vision_capable 期望 |
|---|---|---|
| zhipu | glm-4.5-air | **False** |
| zhipu | glm-4.5-airx | **False** |
| zhipu | glm-4.6 | **False** |
| zhipu | glm-4-plus | **False** |
| zhipu | glm-5 | **False** |
| zhipu | glm-4v | True |
| zhipu | glm-4v-flash | True |
| zhipu | glm-4.1v-thinking-flash | True |
| zhipu | glm-4.5v | True |
| zhipu | glm-4.6v | True |
| zhipu | openai/glm-4.6v | True（带 provider 前缀 slug） |
| zhipu | glm-6-future-vision | True（未知，放行） |

命令：`python -m pytest tests/test_llm_vision.py -q`，全绿。

新建 `desktop/src/utils/model-vision.test.ts`，用 `isKnownNonVisionChatModel("zhipu", m)` 断言相同矩阵（air/4.6/4-plus/5 → true；4v/4.6v/4.1v-thinking → false）。命令：`cd desktop && npx vitest run src/utils/model-vision.test.ts`。

---

## FR-2（P0）：智谱视觉模型多模态请求 `invalid input`(1210) 一次性重试

### 根因
智谱对 `glm-4.6v` 的多模态请求上游不稳，偶发 `code:1210 ... invalid input`。`classify_provider_fault`（`provider_fault.py` 第 40–72 行）无匹配 → 归 `unknown` → `agent_runtime.py` 第 3540 行 `except Exception as exc` 块不重试，直接 yield ERROR 并 `return`。一次抖动 = 整轮失败。

### 设计
在 `agent_runtime.py` 第 3540 行 `except Exception as exc:` 块内、**在 `fault == "rate_limit"` 分支之前**，新增一次性重试：满足「provider=zhipu 且当前 `messages_for_llm` 含 image_url 且异常文本为智谱瞬时 `invalid input`（含 `invalid input` 或 `1210`，但排除确定性 `取值范围` + `text` 的参数非法）且本轮未重试过」→ 置会话级 flag，yield 一条 warning 提示，`continue` 重进循环重试本轮。

参照同块第 3603–3623 行已有的 `context_chain_repair` 一次性 `continue` 重试模式（同样用 setattr flag 防重入 + `continue`），保持风格一致。

### 落点
文件：`/Users/damon/myWork/AgenticX/agenticx/runtime/agent_runtime.py`

**Step 1** — 在模块中新增两个纯函数（放在第 1502 行 `_zhipu_tool_stream_supported` 定义之后即可，或紧邻 `classify_provider_fault` 使用处上方；位置不敏感，只需模块级可见）：

```python
def _messages_contain_image(messages: Any) -> bool:
    """True when any message carries an image_url content block."""
    if not isinstance(messages, (list, tuple)):
        return False
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and str(block.get("type", "")) == "image_url":
                    return True
    return False


def _is_zhipu_transient_invalid_input(exc: BaseException) -> bool:
    """Zhipu multimodal requests flake with 1210 'invalid input' upstream.

    Excludes the *deterministic* text-only rejection (content.type 参数非法,
    取值范围 ['text']) which must NOT be retried — that model simply cannot
    take images (handled by FR-1 stripping instead).
    """
    text = f"{type(exc).__name__} {exc}".lower()
    if "取值范围" in text and "text" in text:
        return False
    return "invalid input" in text or "1210" in text
```

**Step 2** — 在第 3540 行 `except Exception as exc:` 块，`fault = classify_provider_fault(exc)` 之后、`if fault == "rate_limit"` 之前插入：

```python
                # 智谱视觉模型「多模态 + 工具」请求偶发 1210 invalid input（上游抖动）。
                # 同请求重试常成功，做一次会话级一次性重试再放弃。
                if (
                    provider_name.strip().lower() == "zhipu"
                    and _messages_contain_image(messages_for_llm)
                    and _is_zhipu_transient_invalid_input(exc)
                    and not getattr(session, "_zhipu_vision_flake_retry_attempted", False)
                ):
                    setattr(session, "_zhipu_vision_flake_retry_attempted", True)
                    yield RuntimeEvent(
                        type=EventType.ERROR.value,
                        data={
                            "text": "视觉模型上游返回参数错误，正在自动重试一次…",
                            "severity": "warning",
                            "detector": "zhipu_vision_flake_retry",
                            "retryable": True,
                        },
                        agent_id=agent_id,
                    )
                    continue
```

> 变量 `messages_for_llm`、`provider_name`、`session`、`agent_id`、`RuntimeEvent`、`EventType` 均在该作用域可见（同函数上文已使用）。**不要 sleep**（周边 `context_chain_repair` 也是即时 `continue`；如需退避，仅在确认本函数为 async generator 时用 `await asyncio.sleep(0.8)`，否则保持无 sleep）。
>
> flag 命名 `_zhipu_vision_flake_retry_attempted` 挂在 `session` 上，作用域为本次 turn 的这一轮循环；无需清理（下一个 user turn 是新的 run，session 对象若复用也只会多放行一次重试，可接受）。若担心跨轮残留，可在函数入口（首个 round 之前）`setattr(session, "_zhipu_vision_flake_retry_attempted", False)`——**可选，非必须**。

### AC-2
新建 `tests/test_zhipu_vision_flake_retry.py`：
1. `test_messages_contain_image_true_false`：构造含/不含 `image_url` 块的消息，断言 `_messages_contain_image` 返回 True/False。
2. `test_transient_invalid_input_classification`：
   - `Exception("litellm.BadRequestError: ... invalid input")` → True
   - `Exception("code 1210 ...")` → True
   - `Exception("messages.content.type 参数非法，取值范围 ['text']")` → **False**（确定性，不重试）
   - `Exception("rate limit exceeded")` → False

命令：`python -m pytest tests/test_zhipu_vision_flake_retry.py -q`。

> 完整的「异常块内 continue 重试」端到端行为难在单测覆盖（需 mock 流式循环）。AC 以上述两个纯函数单测 + 下方手工冒烟为准。

**手工冒烟（实施后自测，写入 PR 描述）**：
- 起本地 `agx serve`；新建会话选 `glm-4.6v`，发一张图 + 全量工具场景，若命中 1210，日志应出现 `detector=zhipu_vision_flake_retry` 且第二次尝试常成功。
- 不便复现抖动时，可临时在 `_invoke_once_with_fallback` / stream 首次调用注入一次性假异常验证 `continue` 分支被走到（验证后回退注入代码，勿提交）。

---

## FR-3（P0）：中断卡透出真实失败原因，不再一律「工具后无响应」

### 根因
- 后端 `agenticx/studio/turn_interruption.py` `interruption_notice_content`（第 77–86 行）对 `runtime_failure` 直接用固定 `_CAUSE_MESSAGES["runtime_failure"]`，不含真实错误。
- 前端 `TurnInterruptionNoticeLine.tsx` 第 17 行硬编码文案，无视 `message.content` 与 `cause`。

### 后端改动
文件：`/Users/damon/myWork/AgenticX/agenticx/studio/turn_interruption.py`

**Step 1** — 新增读取真实失败摘要的 helper（放在第 26 行 `_DETECTOR_MESSAGES` 之后）：

```python
def _last_failure_summary(session: Any) -> str:
    """Short, user-facing summary of the last hard model failure (if any)."""
    scratch = getattr(session, "scratchpad", None)
    if not isinstance(scratch, dict):
        return ""
    raw = scratch.get("__last_turn_failure__")
    if not isinstance(raw, dict):
        return ""
    text = str(raw.get("text", "") or "").strip()
    if not text:
        return ""
    # Strip noisy SDK prefixes so the user sees the vendor message.
    for prefix in (
        "模型调用失败: ",
        "litellm.BadRequestError: ",
        "OpenAIException - ",
    ):
        if text.startswith(prefix):
            text = text[len(prefix):].lstrip()
    # Some messages are "A: B: <real>"; collapse repeated prefixes once more.
    text = text.replace("litellm.BadRequestError: ", "").replace("OpenAIException - ", "")
    return text[:120].strip()
```

**Step 2** — 修改 `interruption_notice_content`（第 77–86 行）：runtime_failure 且有 summary 时，把真实摘要拼进正文。

Before：
```python
def interruption_notice_content(
    *,
    cause: str,
    session: Any,
    detector: str | None = None,
) -> str:
    key = cause if cause in _CAUSE_MESSAGES else "unknown"
    if key in {"no_final", "unknown"} and _last_row_is_tool_result(session):
        return _CAUSE_MESSAGES["no_final"] + _detector_suffix(detector)
    return _CAUSE_MESSAGES[key] + _detector_suffix(detector)
```
After：
```python
def interruption_notice_content(
    *,
    cause: str,
    session: Any,
    detector: str | None = None,
) -> str:
    key = cause if cause in _CAUSE_MESSAGES else "unknown"
    if key == "runtime_failure":
        summary = _last_failure_summary(session)
        if summary:
            return f"模型调用失败：{summary}。可点「恢复执行」重试。"
    if key in {"no_final", "unknown"} and _last_row_is_tool_result(session):
        return _CAUSE_MESSAGES["no_final"] + _detector_suffix(detector)
    return _CAUSE_MESSAGES[key] + _detector_suffix(detector)
```

**Step 3** — 在 `append_turn_interruption_notice`（第 107–144 行）把摘要写进 metadata，供前端读取。定位第 127–134 行 metadata 构造，Before：
```python
    metadata = {
        "kind": TURN_INTERRUPTED_KIND,
        "cause": cause,
        "source": "runtime",
    }
    normalized_detector = _normalize_detector(detector)
    if normalized_detector:
        metadata["detector"] = normalized_detector
```
After：
```python
    metadata = {
        "kind": TURN_INTERRUPTED_KIND,
        "cause": cause,
        "source": "runtime",
    }
    normalized_detector = _normalize_detector(detector)
    if normalized_detector:
        metadata["detector"] = normalized_detector
    if cause == "runtime_failure":
        _summary = _last_failure_summary(session)
        if _summary:
            metadata["failure_summary"] = _summary
```

### 前端改动
文件 A：`/Users/damon/myWork/AgenticX/desktop/src/utils/turn-interruption-notice.ts`

在 `parseTurnInterruptionNotice` 返回值加 `failureSummary`。定位第 31–50 行，Before 返回类型与 return：
```typescript
export function parseTurnInterruptionNotice(message: NoticePick): {
  cause: TurnInterruptionCause;
  text: string;
} | null {
  ...
  const text = String(message.content ?? "").trim();
  if (!text) return null;
  return { cause, text };
}
```
After：
```typescript
export function parseTurnInterruptionNotice(message: NoticePick): {
  cause: TurnInterruptionCause;
  text: string;
  failureSummary: string;
} | null {
  ...
  const text = String(message.content ?? "").trim();
  if (!text) return null;
  const failureSummary = String(meta.failure_summary ?? "").trim();
  return { cause, text, failureSummary };
}
```
（`meta` 已在函数内定义为 `message.metadata`。）

文件 B：`/Users/damon/myWork/AgenticX/desktop/src/components/messages/TurnInterruptionNoticeLine.tsx`

修改第 15–17 行文案派生，按 cause 分流并优先展示真实摘要。

Before：
```typescript
  const parsed = parseTurnInterruptionNotice(message);
  const isUserInterrupt = parsed?.cause === "user_interrupt";
  const text = isUserInterrupt ? "已中断" : "上一步工具执行后未收到模型响应";
```
After：
```typescript
  const parsed = parseTurnInterruptionNotice(message);
  const cause = parsed?.cause;
  const isUserInterrupt = cause === "user_interrupt";
  let text: string;
  if (isUserInterrupt) {
    text = "已中断";
  } else if (cause === "runtime_failure") {
    // Prefer the real upstream error surfaced by the backend; fall back to the
    // notice content, then a generic label. Never mislabel a model API 400 as
    // "工具执行后未收到模型响应".
    text = parsed?.failureSummary
      ? `模型调用失败：${parsed.failureSummary}`
      : (parsed?.text || "模型调用失败，本轮未完成");
  } else {
    text = "上一步工具执行后未收到模型响应";
  }
```

> 只有 `no_final` / `unknown` 等「确实工具后无 final」的场景才保留原文案；`runtime_failure`（API 400/鉴权/参数等）显示真因。

### AC-3
- 后端：追加 `tests/test_chat_turn_interruption_notice.py`：构造一个 `session.scratchpad["__last_turn_failure__"] = {"text": "模型调用失败: litellm.BadRequestError: OpenAIException - API 调用参数有误，请检查文档。invalid input", "detector": "unknown"}` 且 `chat_history` 含至少一条 user 的 fake session，调用 `append_turn_interruption_notice(session, cause="runtime_failure", saw_final=False)`，断言：
  - 追加的 tool 行 `content` 含「模型调用失败：」且含「invalid input」，不含「工具执行后未收到模型响应」。
  - `metadata["failure_summary"]` 含「invalid input」、不含「litellm.BadRequestError」前缀。
  - 命令：`python -m pytest tests/test_chat_turn_interruption_notice.py -q`。
- 前端：追加 `desktop/src/utils/turn-interruption-notice.test.ts`：构造 `metadata.cause="runtime_failure"`、`metadata.failure_summary="API 调用参数有误…invalid input"` 的 message，断言 `parseTurnInterruptionNotice(...).failureSummary` 命中。命令：`cd desktop && npx vitest run src/utils/turn-interruption-notice.test.ts`。

---

## FR-4（P1）：`tool_stream` 门控排除视觉 SKU

### 根因
`agenticx/runtime/agent_runtime.py` 第 1493–1499 行 `_GLM_TOOL_STREAM_MODEL_PREFIXES` 含 `"glm-4.6"`；第 1514 行 `model.startswith(...)` 使 `glm-4.6v` 命中 → 视觉模型被误开增量工具流。

### 落点
文件：`/Users/damon/myWork/AgenticX/agenticx/runtime/agent_runtime.py`，函数 `_zhipu_tool_stream_supported`（第 1502–1514 行）。

Before（第 1510–1514 行函数体）：
```python
    provider = str(provider_name or "").strip().lower()
    model = str(model_name or "").strip().lower().split("/")[-1]
    is_glm_route = provider == "zhipu" or provider.startswith("custom_openai_")
    return is_glm_route and model.startswith(_GLM_TOOL_STREAM_MODEL_PREFIXES)
```
After：
```python
    provider = str(provider_name or "").strip().lower()
    model = str(model_name or "").strip().lower().split("/")[-1]
    is_glm_route = provider == "zhipu" or provider.startswith("custom_openai_")
    # Vision SKUs (glm-4.6v, glm-4.5v, ...) must not opt into incremental
    # tool-call streaming; the prefix table targets text GLM-4.7/5.x only.
    if re.search(r"\dv|vision|vl", model):
        return False
    return is_glm_route and model.startswith(_GLM_TOOL_STREAM_MODEL_PREFIXES)
```

> 确认 `re` 已在 `agent_runtime.py` 顶部 import（该文件广泛用正则；若未 import 则在文件顶部 import 区补 `import re`，遵守「只增不删、不重排相邻行」）。

### AC-4
新建 `tests/test_zhipu_tool_stream_gate.py`：
- `_zhipu_tool_stream_supported("zhipu", "glm-4.7")` → True
- `_zhipu_tool_stream_supported("zhipu", "glm-5")` → True
- `_zhipu_tool_stream_supported("zhipu", "glm-4.6")` → True
- `_zhipu_tool_stream_supported("zhipu", "glm-4.6v")` → **False**
- `_zhipu_tool_stream_supported("zhipu", "glm-4.5v")` → **False**
- `_zhipu_tool_stream_supported("custom_openai_x", "glm-4.7")` → True

命令：`python -m pytest tests/test_zhipu_tool_stream_gate.py -q`。

---

## FR-5（P2，可选）：低 `max_tokens` 上限模型自适应降级重试

### 根因
`agent_runtime.py` 流式（第 2888 行 `"max_tokens": 8192`）与 invoke（第 3191 行 `max_tokens=8192`）固定 8192；`glm-4v-flash` 等上限仅 1024 → `max_tokens参数非法：限制数值范围[1,1024]`。

### 设计（捕获式降级，避免维护每模型上限表）
在第 3540 行 `except Exception as exc:` 块内（与 FR-2 相邻，放在 FR-2 判断之后），新增：异常文本含 `max_tokens` 且含 `1024`（或用正则抓 `范围[1,(\d+)]` 的上限）且本轮未降级过 → 置 flag `_max_tokens_downshifted`，把后续调用的 `max_tokens` 降到解析出的上限（无法解析时降到 1024），yield warning，`continue`。

> **实施注意**：8192 是硬编码在多处调用点（stream_kwargs / invoke），要让「重试用更小 max_tokens」生效，最省的做法是引入一个会话级覆盖值（如 `getattr(session, "_max_tokens_override", None)`），在第 2888 / 3191 行构造调用参数时 `max_tokens = getattr(session, "_max_tokens_override", None) or 8192`，异常块里 setattr 覆盖后 `continue`。若判断改动面偏大或风险偏高，**本 FR 可整体跳过**，仅在结论里注明「flash 视觉模型请手动避免」，不阻塞 FR-1~4 交付。

### AC-5（若实施）
新建纯函数 `_parse_max_tokens_cap(exc) -> int | None` 并单测：`"max_tokens参数非法：限制数值范围[1,1024]"` → 1024；无关错误 → None。命令：`python -m pytest tests/test_max_tokens_cap.py -q`。

---

## 交付顺序与验收门槛

建议单分支 `fix/glm-vision-continue-hardening`（从当前 `origin/main` 切），按 P0→P1→(P2) 顺序提交，可分 2–3 个 commit：

1. **commit 1（FR-1）**：`vision.py` + `model-vision.ts` + 双端测试。
2. **commit 2（FR-2 + FR-3）**：`agent_runtime.py`（invalid input 重试）+ `turn_interruption.py` + 两个前端文件 + 测试。
3. **commit 3（FR-4，可选叠 FR-5）**：`agent_runtime.py` tool_stream 门控 + 测试。

**每个 commit 合入前强制门槛：**
- `python -m pytest tests/test_llm_vision.py tests/test_chat_turn_interruption_notice.py tests/test_zhipu_vision_flake_retry.py tests/test_zhipu_tool_stream_gate.py -q` 全绿（按该 commit 覆盖范围取子集）。
- `cd desktop && npx vitest run src/utils/model-vision.test.ts src/utils/turn-interruption-notice.test.ts` 全绿。
- `cd desktop && npm run build`（或 `npx tsc --noEmit`）通过——因动了 `.tsx` / `.ts` 类型。
- **本 plan 不改 `agenticx/studio/server.py`，无需 `agx serve` 冷启动门槛**；但若实施中确有必要触碰它，则必须按 AGENTS.md 跑一次 `agx serve` 冷启动 smoke（`/api/session`、`/api/avatars`、`/api/sessions` 返回 200）。

**最终手工验收（写入 PR 描述）：**
1. 选 `glm-4.5-air` + 附图发送 → 前端应拦截/提示非视觉并剥图（不再上游 400）。
2. 新建会话选 `glm-4.6v` + 同图 → 正常出结果；若命中 1210，日志见 `zhipu_vision_flake_retry` 且第二次成功。
3. 构造一次 runtime_failure → 中断卡显示「模型调用失败：<真实原因>」，不再是「工具执行后未收到模型响应」。

---

## Commit 元数据（实施者提交时按实际填写）

```
Plan-Id: 2026-07-23-glm-vision-continue-hardening
Plan-File: .cursor/plans/2026-07-23-glm-vision-continue-hardening.plan.md
Plan-Model: Opus 4.8
Impl-Model: <实际使用，用户指定为 grok 4.5 high fast>
Made-with: Damon Li
```
