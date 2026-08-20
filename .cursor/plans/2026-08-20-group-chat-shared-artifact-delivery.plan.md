# 群共享工作区与结构化产物交付

Planned-with: GPT-5.6 Sol
Suggested-Impl-Model: Cursor Grok 4.6（跨 SessionManager、群 runtime、SSE、Desktop 持久化）
Status: implemented
Plan-Id: 2026-08-20-group-chat-shared-artifact-delivery
Parent-Plan: 2026-08-20-group-chat-control-room-experience

> **For implementer:** 只改本 plan 列出的路径。触碰 `agenticx/studio/server.py` 时只能精确插入目标字段，禁止替换 import 或 handler 整段；完成后必须冷启动 `agx serve` 并验证核心 API。不要移动、删除或自动迁移用户旧文件。不要 commit，除非用户明确要求。

**Goal:** 群内长任务统一写入该群共享工作区；系统自动识别本轮新增/修改产物，通过结构化附件送到 Desktop，最终气泡展示可点击产物芯片，而不是依赖模型正确输出路径。

**Architecture:** 先修正 `group:<gid>` 会话的 workspace 解析，让同群所有 session 和成员共享 `~/.agenticx/groups/<gid>/workspace`。成员执行前后对 taskspaces 做轻量文件指纹快照，差集写入 `GroupReply.artifacts`。Studio SSE 透传附件并随 assistant history 持久化；Desktop 把它映射为已有 `MessageAttachment`，复用当前工作区预览。

**Tech Stack:** Python、Studio SessionManager、GroupChatContext、GroupChatRouter、FastAPI SSE、React/Zustand、pytest、vitest。

---

## In scope

- 群 session 默认 workspace → 群共享目录
- 同群跨 session 共享
- 顶层记忆文件不算产物
- 执行前后产物指纹扫描
- `GroupArtifact` / `GroupReply.artifacts`
- `GroupChatContext.append_agent(... attachments=...)`
- Studio SSE `artifacts`
- Desktop `group_reply` 映射成 `MessageAttachment[]`
- 历史 reload 保留附件
- 点击产物打开工作区预览

## Out of scope

- 不迁移旧群曾写在 `$HOME` 的文件
- 不自动删除临时文件
- 不把所有历史 taskspace 文件都塞给每条回复
- 不改普通单聊 workspace
- 不改消息气泡视觉（P4）
- 不实现版本管理或多人文件锁
- 不把产物上传云端

---

## FR-1：群 session 绑定群共享工作区

**Files:**

- Modify: `agenticx/studio/session_manager.py:apply_session_workspace_dir`
- Use: `agenticx/workspace/loader.py:ensure_group_workspace`（不改）
- Test: `tests/test_group_shared_artifact_delivery.py`

在 `agenticx/studio/session_manager.py` 顶部已有 workspace loader import 中精确增加 `ensure_group_workspace`（禁止函数内 inline import），然后在 `avatar_raw` 优先分支之后插入：

```python
avatar_id_raw = str(getattr(managed, "avatar_id", "") or "").strip()
if avatar_raw:
    resolved = resolve_default_session_workspace_dir(
        avatar_workspace_dir=avatar_raw
    )
elif avatar_id_raw.startswith("group:"):
    group_id = avatar_id_raw.removeprefix("group:").strip()
    resolved = (
        ensure_group_workspace(group_id)
        if group_id
        else Path(self._resolve_taskspace_root(managed.session_id, None))
    )
elif not avatar_id_raw:
    resolved = Path(self._resolve_taskspace_root(managed.session_id, None))
else:
    resolved = resolve_default_session_workspace_dir()
```

方法末尾现有 `rebind_default_taskspace_to_workspace(managed)` 保留。

**AC:**

- 两个不同 session、同 `group:g1` → 相同 workspace
- Meta session 仍是 per-session taskspace
- avatar 单聊和 automation 行为不变
- default taskspace path 等于群 workspace
- `align_meta_session_workspace` 不覆盖群 session

---

## FR-2：统一产物过滤与指纹

**Files:**

- Modify: `agenticx/runtime/group_facts.py`
- Test: `tests/test_group_shared_artifact_delivery.py`

增加：

```python
GROUP_INTERNAL_FILENAMES = frozenset(
    {"IDENTITY.md", "MEMORY.md", "USER.md", "SOUL.md", "favorites.json"}
)

@dataclass(frozen=True)
class ArtifactFingerprint:
    size: int
    mtime_ns: int

def scan_artifact_snapshot(
    taskspaces: Sequence[Any] | None,
) -> dict[str, ArtifactFingerprint]:
    ...

def changed_artifact_paths(
    before: Mapping[str, ArtifactFingerprint],
    after: Mapping[str, ArtifactFingerprint],
    *,
    limit: int = 8,
) -> list[str]:
    ...
```

扫描规则：

1. 只扫真实目录。
2. 跳过 `memory/`、`.git/`、`node_modules/`、`.venv/`、`__pycache__/`。
3. 仅扫描根目录顶层时跳过 `GROUP_INTERNAL_FILENAMES`；`docs/MEMORY.md` 仍算产物。
4. symlink 文件不跟随，防止越过 taskspace。
5. 指纹只用 `st_size + st_mtime_ns`，不要读文件正文。
6. 差集包含新文件和指纹变化的已有文件，按 `mtime_ns desc + path` 排序，最多 8 个。
7. `collect_artifact_paths` 复用同一过滤器，避免两套规则漂移。

**AC:**

- 新建和修改可识别
- 未变文件不返回
- 删除文件不作为可点击产物返回
- 记忆文件、依赖目录、symlink 不返回
- 结果稳定且有上限

---

## FR-3：`GroupReply` 携带结构化产物

**Files:**

- Modify: `agenticx/runtime/group_router.py`
- Test: `tests/test_group_shared_artifact_delivery.py`

新增：

```python
@dataclass(frozen=True)
class GroupArtifact:
    name: str
    source_path: str
    mime_type: str
    size: int

@dataclass
class GroupReply:
    # existing fields...
    artifacts: list[GroupArtifact] = field(default_factory=list)
```

新增纯函数：

```python
def _group_artifacts_from_paths(paths: Sequence[str]) -> list[GroupArtifact]:
    ...
```

- `name = Path(path).name`
- `source_path = str(Path(path).resolve(strict=False))`
- `mime_type = mimetypes.guess_type(path)[0] or "application/octet-stream"`
- `size = stat().st_size`
- stat 失败则跳过，不让回复失败

在 `_run_one_target`：

1. 创建 `local_session` 并继承 taskspaces 后，runtime 启动前记录 `artifact_before`。
2. runtime 结束后记录 `artifact_after`。
3. 仅对非 skipped 且有 FINAL 的 reply 设置 `artifacts`。
4. `context.append_agent` 同时写 attachments（FR-4）。
5. error / skipped 不挂产物；文件仍留在工作区，防止半成品被包装成完成交付。

在 `_run_meta_project_manager_reply` 的轻量无工具路径不扫描、不挂产物。

**AC:**

- fake tool 新建两个文件 → reply 有两个 artifact
- 修改既有文件 → artifact 包含该文件
- skipped/error → artifacts 为空
- 无新文件 → 空列表

---

## FR-4：群历史持久化附件

**Files:**

- Modify: `agenticx/runtime/group_context.py:append_agent`
- Test: `tests/test_group_shared_artifact_delivery.py`

签名：

```python
def append_agent(
    self,
    *,
    agent_id: str,
    agent_name: str,
    text: str,
    avatar_url: str = "",
    attachments: Sequence[Mapping[str, Any]] | None = None,
) -> None:
```

history row 只在 attachments 非空时增加：

```python
"attachments": [dict(item) for item in attachments or []],
```

Router 转换为现有后端消息 schema：

```python
attachments = [
    {
        "name": a.name,
        "mime_type": a.mime_type,
        "size": a.size,
        "source_path": a.source_path,
        "reference_token": True,
        "kind": "context_file",
    }
    for a in artifacts
]
```

不要把附件正文塞进 history。

**AC:** append 后 `chat_history[-1]["attachments"]` 可被现有 `session-message-map.ts` 解析。

---

## FR-5：SSE 透传产物

**Files:** Modify `agenticx/studio/server.py` 群回复 `SseEvent.data` 构造（约 `3098-3117`）

精确增加：

```python
"artifacts": [
    {
        "name": item.name,
        "mime_type": item.mime_type,
        "size": item.size,
        "source_path": item.source_path,
        "reference_token": True,
    }
    for item in (getattr(reply, "artifacts", None) or [])
],
```

不修改 event_type 白名单；产物依附 `group_reply`。

**AC:** server source smoke 或构造 reply 验证 SSE JSON 字段。

---

## FR-6：Desktop 映射为可点击附件

**Files:**

- Create: `desktop/src/utils/group-artifacts.ts`
- Create: `desktop/src/utils/group-artifacts.test.ts`
- Modify: `desktop/src/components/ChatPane.tsx` 的 `group_reply` 分支

工具函数：

```ts
import type { MessageAttachment } from "../store";

export function parseGroupArtifacts(raw: unknown): MessageAttachment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: MessageAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const sourcePath = String(row.source_path ?? "").trim();
    if (!sourcePath || seen.has(sourcePath)) continue;
    seen.add(sourcePath);
    out.push({
      name: String(row.name ?? "").trim() || sourcePath.split(/[\\/]/).pop() || "file",
      mimeType: String(row.mime_type ?? "").trim() || "application/octet-stream",
      size: Math.max(0, Number(row.size) || 0),
      sourcePath,
      referenceToken: true,
    });
  }
  return out.length ? out.slice(0, 8) : undefined;
}
```

`group_reply`：

```ts
const artifacts = parseGroupArtifacts(payload.data?.artifacts);
addPaneMessageIfSessionActive(
  pane.id,
  "assistant",
  content,
  eventAgentId,
  chatProvider,
  chatModel,
  artifacts,
  { avatarName, avatarUrl: avatarUrl || undefined },
);
```

已有 `ImBubble` 的 `isWorkspaceReferenceAttachment` + `onOpenFileReference` 负责点击预览，不新造文件卡。

**AC:**

- 非数组 / 空路径过滤
- 去重并 cap 8
- `sourcePath`、`referenceToken` 正确
- live reply 与刷新后的历史附件结构一致

---

## FR-7：控制面产物提示词

**Files:** Modify `agenticx/runtime/group_router.py` 成员 system prompt

在 P1 的控制面契约后追加：

```text
## 群共享工作区
- 当前工作目录：{base_session.workspace_dir}
- 需要交付长文、代码、数据时写入该目录或已绑定 taskspace。
- FINAL 只需给 1–3 句结论；系统会自动把本轮新增/修改文件显示为产物芯片。
- 不要伪造路径，不要把未写成的文件说成已交付。
- 用户明确要求全文贴群时，按用户要求直接回答。
```

不要要求模型手写绝对路径；结构化扫描才是事实来源。

---

## 中断语义

1. 停止不会删除已落盘文件。
2. 没有正常 FINAL 的中断轮不生成结构化“完成产物”附件。
3. 文件仍会出现在群工作区，用户可从工作区找回。
4. 下一轮续问时，session taskspaces 和 workspace_dir 不变，可继续修改同一文件。
5. 后续若要给半成品单独状态，归 P3，不在这里扩协议。

---

## 测试与强制验证

```bash
pytest tests/test_group_shared_artifact_delivery.py \
  tests/test_smoke_group_execution_facts.py \
  tests/test_session_manager_persistence.py \
  tests/test_workspace_root_enforcement.py -q

cd desktop && npx vitest run src/utils/group-artifacts.test.ts \
  src/utils/session-message-merge.test.ts
```

期望：全部 PASS。

触碰 `server.py` 后强制：

```bash
agx serve --host 127.0.0.1 --port 19099
```

验证 `/api/session`、`/api/avatars`、`/api/sessions` 返回 200，然后停止临时服务。

手工：

1. 在群里要求专家写一份方案。
2. 文件必须位于 `~/.agenticx/groups/<gid>/workspace/`。
3. 最终气泡出现可点击产物芯片。
4. 点击后在工作区预览打开。
5. 刷新和同群新建 session 后仍可访问。

