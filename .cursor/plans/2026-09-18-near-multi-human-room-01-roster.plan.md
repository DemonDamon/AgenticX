# 子计划 01：群花名册 human_members

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Composer 2.5
Parent-Plan: `.cursor/plans/pending/2026-09-18-near-multi-human-room-master.plan.md`
Depends-on: 无
Plan-Id: 2026-09-18-near-multi-human-room-01-roster

> **For implementer:** 使用 executing-plans，TDD。只加花名册存储与注册 API。不要 commit，除非用户明确要求。

**Goal:** 群配置能持久化人类成员，且人与分身 id 互斥。

**Architecture:** 新纯函数模块生成/校验 `human:<platform>:<external_id>`；`GroupChatConfig` 增加 `human_members`；Studio 增一条 POST，不改现有 create/update 必填项。

**Tech Stack:** Python dataclass + YAML + FastAPI + pytest。

## 实施前只需打开

- `agenticx/avatar/group_chat.py`（152 行）
- `agenticx/studio/server.py` **仅** `create_studio_app` 内 Group Chat CRUD 段（约 L6371–L6449）
- `tests/test_smoke_group_workforce_bridge.py` 里 `TestGroupChatConfigTeamRouting`（确认 `from_dict` 仍忽略未知字段）

## 禁止打开 / 禁止改

- `agenticx/runtime/group_router.py` 全文
- `desktop/`、`enterprise/`
- `agenticx/studio/server.py` 文件顶部 import 区；禁止整段替换任何相邻函数
- `create_group` 的 `name and avatar_ids are required` 校验

## In scope

- `human_members` 读写与去重。
- `POST /api/groups/{group_id}/human-members`。
- GET/POST/PUT `/api/groups*` 经现有 `to_dict()` 带出该字段。

## Out of scope

- 发言者落盘、IM、Desktop UI。
- 改 `avatar_ids` 语义。

---

## 根因

`GroupChatConfig`（`group_chat.py` L36–L53）只有 `avatar_ids`。第二个真人没有稳定 id，无法进房间。

---

## FR-01-1：id 与 XOR 校验

**Files:**

- Create: `agenticx/avatar/group_members.py`
- Test: `tests/test_group_human_members.py`

整文件按下列实现（不要自作聪明加字段）：

```python
#!/usr/bin/env python3
"""Human member ids for group rooms.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Iterable, Literal

HumanPlatform = Literal["desktop", "feishu", "wechat", "wecom"]
ALLOWED_PLATFORMS = frozenset({"desktop", "feishu", "wechat", "wecom"})


def make_human_member_id(platform: str, external_id: str) -> str:
    plat = str(platform or "").strip().lower()
    ext = str(external_id or "").strip()
    if plat not in ALLOWED_PLATFORMS:
        raise ValueError(f"invalid human platform: {platform!r}")
    if not ext or ":" in ext or "/" in ext:
        raise ValueError("invalid human external_id")
    return f"human:{plat}:{ext}"


def parse_human_member_id(member_id: str) -> tuple[str, str]:
    raw = str(member_id or "").strip()
    parts = raw.split(":", 2)
    if len(parts) != 3 or parts[0] != "human" or parts[1] not in ALLOWED_PLATFORMS or not parts[2]:
        raise ValueError(f"invalid human member id: {member_id!r}")
    return parts[1], parts[2]


def normalize_human_member(
    raw: dict[str, Any],
    *,
    avatar_ids: Iterable[str],
) -> dict[str, str]:
    platform = str(raw.get("platform") or "").strip().lower()
    external_id = str(raw.get("external_id") or "").strip()
    member_id = str(raw.get("id") or "").strip()
    if member_id:
        platform, external_id = parse_human_member_id(member_id)
    else:
        member_id = make_human_member_id(platform, external_id)
    if member_id in {str(x).strip() for x in avatar_ids}:
        raise ValueError("human member id collides with avatar_id")
    display = str(raw.get("display_name") or "").strip() or external_id
    return {
        "id": member_id,
        "platform": platform,
        "external_id": external_id,
        "display_name": display,
        "joined_at": str(raw.get("joined_at") or ""),
    }
```

**AC:**

- `make_human_member_id("feishu", "ou_1") == "human:feishu:ou_1"`
- platform 大小写不敏感；非法 platform / 空 external_id / 含 `:` 的 external_id 抛 `ValueError`
- `normalize` 在 `id` 与 avatar_ids 撞车时抛 `ValueError`
- 缺 `id` 时用 platform+external_id 生成

---

## FR-01-2：GroupChatConfig 持久化

**Files:**

- Modify: `agenticx/avatar/group_chat.py` `GroupChatConfig`、`to_dict`、`create_group`、新增 `add_human_member`
- Test: 同 `tests/test_group_human_members.py`

**Before（L36–L47）：**

```python
class GroupChatConfig:
    id: str
    name: str
    avatar_ids: List[str] = field(default_factory=list)
    routing: str = "intelligent"
    created_at: str = ""
    updated_at: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v or k in {"id", "name", "avatar_ids", "routing"}}
```

**After：**

```python
human_members: List[Dict[str, str]] = field(default_factory=list)

def to_dict(self) -> Dict[str, Any]:
    return {
        k: v
        for k, v in asdict(self).items()
        if v or k in {"id", "name", "avatar_ids", "routing", "human_members"}
    }
```

在 `GroupChatRegistry` 增加（不要改 `update_group` 的 immutable 集合，让 `human_members` 可被 patch，但本 FR 的官方入口是下面这个方法）：

```python
def add_human_member(self, group_id: str, raw: Dict[str, Any]) -> Optional[GroupChatConfig]:
    from agenticx.avatar.group_members import normalize_human_member
    from datetime import datetime, timezone

    config = self._read_config(group_id)
    if config is None:
        return None
    member = normalize_human_member(raw, avatar_ids=config.avatar_ids)
    if not member.get("joined_at"):
        member["joined_at"] = datetime.now(timezone.utc).isoformat()
    existing = [
        m for m in (config.human_members or [])
        if isinstance(m, dict) and str(m.get("id") or "") != member["id"]
    ]
    existing.append(member)
    config.human_members = existing
    config.updated_at = datetime.now(timezone.utc).isoformat()
    self._write_config(config)
    return config
```

`from_dict` 已按 `__dataclass_fields__` 过滤，旧 `group.yaml` 无该键时得到 `[]`。不要写迁移脚本。

**AC:**

- 新建群 `human_members == []`，YAML 含 `human_members: []`
- 两次 `add_human_member` 同一 `human:feishu:ou_1` 只留 1 行，`display_name` 以最后一次为准
- `avatar_ids=["abc"]` 时 `id="abc"` 的人必须失败
- `tests/test_smoke_group_workforce_bridge.py::TestGroupChatConfigTeamRouting` 仍绿

---

## FR-01-3：注册 API

**Files:**

- Modify: `agenticx/studio/server.py` —— **只在** `update_group` 的 `return {"ok": True, "group": config.to_dict()}`（约 L6449）**之后**插入新路由。禁止改 `list_groups` / `create_group` / `update_group` 函数体。
- Test: `tests/test_group_human_members.py` 用 `TestClient` 或直接调 `group_registry`；若测 HTTP，复用 `tests/test_work_item_api.py` 的 app fixture 风格。

插入的路由（照抄，只改缩进以匹配邻近路由）：

```python
    @app.post("/api/groups/{group_id}/human-members")
    async def add_group_human_member(
        group_id: str,
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        cfg = group_registry.add_human_member(group_id, payload if isinstance(payload, dict) else {})
        if cfg is None:
            raise HTTPException(status_code=404, detail="group not found")
        return {"ok": True, "group": cfg.to_dict()}
```

`add_human_member` 内 `ValueError` 要变成 400。在 registry 方法里让异常冒泡，路由：

```python
        try:
            cfg = group_registry.add_human_member(...)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
```

**AC:**

- 未知 `group_id` → 404
- 合法 payload → 200，`group.human_members` 含新行
- GET `/api/groups` 的对应项也含该行（`to_dict`）

---

## 验证

```bash
pytest tests/test_group_human_members.py tests/test_smoke_group_workforce_bridge.py::TestGroupChatConfigTeamRouting -q
```

若改了 `server.py`：另起端口冷启动 `agx serve`，curl `/api/session`、`/api/avatars`、`/api/sessions`、`/api/groups` 均为 200。

## Composer 2.5 停止条件

- 不要给 `GroupChatConfig` 加 role/权限字段。
- `update_group` 即使能 patch `human_members`，也不要在本计划改 PUT 校验。
- 不要在 Desktop 加类型（04 再做）。
