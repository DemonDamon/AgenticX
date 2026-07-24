# Meta Session 默认工作区隔离 Implementation Plan

Planned-with: cursor-grok-4.5
Suggested-Impl-Model: composer-2.5

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans / implement task-by-task from this plan alone.

**Goal:** Meta（Near）每个 session 的「默认工作区」固定为 `~/.agenticx/taskspaces/<session_id>/default`；未指定路径时 clone/落盘落在该目录，禁止在 `$HOME` 下自造目录。

**Architecture:** SessionManager 在 Meta 会话对齐/创建时把 `workspace_dir` 与 default taskspace 绑到 per-session 目录；修复 `apply_session_workspace_dir` 对无分身会话误绑共享 `~/.agenticx/workspace`（或残留 `$HOME`）的问题。Meta 系统提示强化「默认写 session 工作区」。

**Tech Stack:** Python (`agenticx/studio/session_manager.py`, `agenticx/runtime/prompts/meta_agent.py`), pytest

---

## 根因与证据

Session `3ad013e9-a301-424f-b11b-199e9cde480d` 元数据：

```json
"taskspaces": [{"id": "default", "label": "默认工作区", "path": "/Users/damon"}]
```

Agent 据此在 `/Users/damon/codebase-analysis/` 下 clone。磁盘上 `~/.agenticx/taskspaces/<sid>/default/` 已存在但未绑定。

创建链路问题（`server.py` 新建 session）：

1. `SessionManager.create` → `align_meta_session_workspace`
2. 随后 `apply_session_workspace_dir(managed)`（无 avatar）→ `resolve_default_session_workspace_dir()` 共享目录，并把 default taskspace **rebind** 走

另：提示词有「用户未明确指定落盘目录时，先建议路径并征求同意」，鼓励自造路径。

## In scope

- Meta（`avatar_id` 空）session：default taskspace + `workspace_dir` → `~/.agenticx/taskspaces/<sid>/default`
- 加载/聊天前 `align_meta_session_workspace`：纠正 `$HOME` / 旧共享默认值 → session 目录
- Meta 提示词：默认落盘到当前 session 默认工作区（或侧栏选中的 taskspace）
- 测试更新

## Out of scope

- 分身（avatar）workspace 策略
- 自动迁移 `$HOME/codebase-analysis` 已有文件
- Desktop UI 大改
- 关闭 `pre_tool_guard` 的 `rm -rf` 规则

## Suggested-Impl 子任务模型

| 子任务 | 推荐模型 | 理由 |
|--------|----------|------|
| SessionManager 对齐逻辑 | composer-2.5 | 后端小改 + 既有测试可跟 |
| Meta 提示词 | composer-2.5 | 文案约束 |
| 测试 | composer-2.5 | 样板 pytest |

---

### Task 1: 失败测试（Meta 对齐到 session 目录）

**Files:**
- Modify: `tests/test_default_session_workspace.py`

**改动意图：**

将 `test_align_meta_session_workspace_migrates_home_dir` 的期望从「共享 canonical workspace」改为：

```python
expected = str(
    (Path(manager._taskspaces_root) / managed.session_id / "default").resolve()
)
assert managed.studio_session.workspace_dir == expected
assert managed.taskspaces[0]["path"] == expected
```

新增：

```python
def test_apply_session_workspace_dir_meta_uses_session_taskspace(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    manager = SessionManager()
    manager._taskspaces_root = str(tmp_path / "taskspaces")
    managed = ManagedSession(session_id="sid-meta", studio_session=StudioSession())
    manager.apply_session_workspace_dir(managed)  # no avatar
    expected = str((tmp_path / "taskspaces" / "sid-meta" / "default").resolve())
    assert managed.studio_session.workspace_dir == expected
    manager._ensure_default_taskspace(managed)
    assert any(t["id"] == "default" and t["path"] == expected for t in managed.taskspaces)
```

Run: `pytest tests/test_default_session_workspace.py -q` → 期望旧 align 测试先失败。

---

### Task 2: SessionManager 实现

**Files:**
- Modify: `agenticx/studio/session_manager.py` → `align_meta_session_workspace`（约 2852–2874）
- Modify: 同文件 `apply_session_workspace_dir`（约 2837–2850）

**`align_meta_session_workspace` after：**

```python
def align_meta_session_workspace(self, managed: ManagedSession) -> None:
    if str(getattr(managed, "avatar_id", "") or "").strip():
        return
    session_root = self._resolve_taskspace_root(managed.session_id, None)
    managed.studio_session.workspace_dir = session_root
    self._ensure_default_taskspace(managed)
    for ts in managed.taskspaces:
        if ts.get("id") == "default":
            ts["path"] = session_root
            ts["label"] = ts.get("label") or "默认工作区"
            return
```

**`apply_session_workspace_dir` after：**

```python
def apply_session_workspace_dir(
    self,
    managed: ManagedSession,
    *,
    avatar_workspace_dir: str | None = None,
) -> None:
    from agenticx.workspace.loader import resolve_default_session_workspace_dir

    avatar_raw = (avatar_workspace_dir or "").strip()
    if avatar_raw:
        resolved = resolve_default_session_workspace_dir(
            avatar_workspace_dir=avatar_raw,
        )
    elif not str(getattr(managed, "avatar_id", "") or "").strip():
        resolved = Path(self._resolve_taskspace_root(managed.session_id, None))
    else:
        resolved = resolve_default_session_workspace_dir()
    managed.studio_session.workspace_dir = str(resolved)
    self.rebind_default_taskspace_to_workspace(managed)
```

说明：`~/.agenticx/workspace` 仍作身份/记忆（SOUL/MEMORY），与「本会话干活目录」分离。

Run: `pytest tests/test_default_session_workspace.py -q` → PASS

---

### Task 3: Meta 提示词

**Files:**
- Modify: `agenticx/runtime/prompts/meta_agent.py`
  - `_build_taskspaces_context`（约 439–456）
  - 「用户未明确指定落盘目录时…」（约 945）

**`_build_taskspaces_context` 追加意图：**

- 未指定路径时，clone / `file_write` / 报告默认写 **default（或侧栏选中）taskspace**
- 禁止在 `$HOME` 下新建平行目录（如 `~/codebase-analysis`）
- 用户明确给绝对路径时才可写外部

**替换约 945 行：**

Before: `用户未明确指定落盘目录时，先建议路径并征求同意，再安排写入动作。`

After: `用户未明确指定落盘目录时，直接写入「当前会话工作区」中的默认（或侧栏选中）路径，无需再征求路径；禁止在 $HOME 下自造新目录名。`

**Test:** `tests/test_meta_agent_taskspaces_context.py` 断言 block 含「禁止在 `$HOME`」或「默认写入」类关键字。

---

### Task 4: 验收

```bash
pytest tests/test_default_session_workspace.py tests/test_meta_agent_taskspaces_context.py -q
```

手工（重启 Near / `agx serve` 后）：

1. 新建 Meta 对话 → 工作区面板「默认工作区」路径为 `~/.agenticx/taskspaces/<新sid>/default`
2. 打开旧脏 session（default=`$HOME`）发一条消息 → align 后应变为 session 目录
3. 说「拉代码」→ clone 落在该 default 下，不再出现 `~/codebase-analysis`

---

## AC

- FR-1: Meta 新 session 的 default taskspace = `~/.agenticx/taskspaces/<sid>/default`
- FR-2: Meta default 为 `$HOME` 时，align/chat 入口纠正为 session 目录
- FR-3: Meta 无 avatar 调用 `apply_session_workspace_dir` 不绑共享 workspace
- FR-4: 提示词要求默认写 session 工作区、禁 `$HOME` 自造目录
- AC-1: `tests/test_default_session_workspace.py` 全绿
- AC-2: `tests/test_meta_agent_taskspaces_context.py` 全绿
