# 技能目录改为短摘要

Planned-with: grok 4.6
Suggested-Impl-Model: composer-2.5

## 根因

同一句 `wb_bridge_start` 在 ToolSearch 生效后仍报 ↑51.6K。`cache_prefix` 里 `<session-context>` 28 490 字，本机重建「已注册能力」约 19 942 字，其中 `_build_skills_context` 对 **126** 个技能各截 **160** 字，技能块约 **18 265** 字。`skill_use`（`agenticx/cli/studio_skill.py` L89–119）已经会把完整 `SKILL.md` 写入 `context_files`，目录不必再带 when-to-use。

## 方案

只改 Meta 会话目录渲染：每行 `name + 短摘要`（先取首句，再截到 48 字）。目录头补一句「完整步骤请 `skill_use`」。不改 `skill_use`、CORE、MCP、静态系统提示、`_serialize_skill_summaries`（分身/实现体路径）。

## In scope

- `agenticx/runtime/prompts/meta_agent.py`：`_skill_catalog_hint` + `_build_skills_context`
- `tests/test_prompt_token_diet.py` 断言跟上

## Out of scope

- 压缩静态 system prompt、工作区块、分身 `_serialize_skill_summaries`
- 清 ToolSearch `loaded_ids`
- 改 `server.py` 顶部 import（avatar 路径已调用 `_build_skills_context`，会自动变瘦）

---

### FR-1: 目录只留短摘要

**落点：** `agenticx/runtime/prompts/meta_agent.py` 约 L37–69

```
MAX_SKILL_CATALOG_HINT_CHARS = 48
MAX_SKILL_DESCRIPTION_CHARS = MAX_SKILL_CATALOG_HINT_CHARS
```

新增：

```python
def _skill_catalog_hint(description: str) -> str:
    text = str(description or "").strip() or "(无描述)"
    for sep in ("。", ".", "；", ";", "\n"):
        head, _, _ = text.partition(sep)
        if _ and head.strip():
            text = head.strip()
            break
    if len(text) > MAX_SKILL_CATALOG_HINT_CHARS:
        return text[: MAX_SKILL_CATALOG_HINT_CHARS - 1] + "…"
    return text
```

`_build_skills_context` 在标题下增加一行：

`完整步骤与 when-to-use 不在此列出；需要对某技能时调用 skill_use。`

每行仍为 `- {name}: {hint}`，hint 走 `_skill_catalog_hint`。

**AC-1：** `tests/test_prompt_token_diet.py`

- `_skill_catalog_hint("短句。后面很长很长") == "短句"`
- `_skill_catalog_hint("x"*80)` 长度为 48 且以 `…` 结尾
- `_build_skills_context([{"name":"foo","description":"x"*200}])` 含 `foo`、`skill_use`，且该行 hint ≤ 48
- 既有 `test_skill_descriptions_are_capped` 仍绿（上限变为 48）
- 既有 `test_skill_catalog_is_not_rendered_twice` 仍绿

## 验证

```bash
/Users/damon/.local/bin/python3.12 -m pytest tests/test_prompt_token_diet.py -q
```

本机量（已测）：126 个技能，旧目录 18 265 字 → 新目录 **7 414** 字（省 10 851 字 / 59.4%），126 个 name 都还在。按上一轮 1.395 字/token，账单大约再少 ~7.8K。须完全退出 Desktop / `agx serve` 后再发同一句才能看到气泡下降。
