# 数字专家默认头像统一为线稿

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Composer 2.5

> 实施前把本文件移到 `.cursor/plans/` 根目录，再从当前 `main` 开分支。

---

## 0. 基线与根因（不依赖对话记忆）

数字专家画廊（`desktop/src/components/gallery/AvatarGalleryView.tsx` L242–247）只渲染 `avatar.avatarUrl`，**没有** CSS `grayscale`。彩色/黑白差在落盘 PNG 本身。

默认头像由 `agenticx/avatar/portrait.py` 向 DiceBear 拉 PNG，写入 `~/.agenticx/avatars/<id>/avatar.yaml` 的 `avatar_url`。

| 时代 | 集合 | 观感 | 本机痕迹 |
|---|---|---|---|
| 当前 `main` | `https://api.dicebear.com/9.x/avataaars/png`（`portrait.py` L36） | 高饱和卡通圆底 | 7/30 手建专家无 `portrait_style` |
| 另一条未进 `main` 的实现 | `https://api.dicebear.com/9.x/notionists/png` | Notion 式低饱和线稿 | `portrait_style: notionists-v1` |

`needs_portrait_refresh`（`portrait.py` L191–196）只刷新空 URL / 几何 SVG。已有 PNG **永不替换**。`AvatarConfig`（`registry.py` L101–125）也没有 `portrait_style` 字段，YAML 里已有的 `notionists-v1` 会被 `from_dict` 丢掉。

产品决定：默认与存量自动头像统一为 **Notionists 线稿**。用户手动上传的图不覆盖。

---

## 1. 推荐实施模型

| 子任务 | 推荐模型 | 理由 |
|---|---|---|
| 测试 + `portrait.py` / `registry.py` 接线 | Composer 2.5 | 后端样板、契约清楚，无需顶配 |

Suggested-Impl-Model: Composer 2.5

---

## 2. In scope / Out of scope

### In scope

- FR-1: 新建专家未指定头像时，生成 DiceBear **notionists** 线稿 PNG（失败则仍用现有本地 SVG）
- FR-2: `list_avatars` 把非线稿的**自动**头像迁移成 notionists，并落盘 `portrait_style: notionists-v1`
- FR-3: 已是 `notionists-v1` 的不重拉（脸稳定）
- FR-4: 用户上传的头像标 `custom`，之后不再被迁移覆盖
- FR-5: 设置里清空头像（「恢复默认」后保存）按当前线稿重生成

### Out of scope（严禁顺手做）

- 不改画廊 / 设置面板视觉（除后端字段透出，前端可忽略）
- 不重写离线 SVG 几何回退（`build_avatar_portrait_svg` 保持现有实现）
- 不改 `agenticx/studio/server.py` 的 import 区
- 不提交 `~/.agenticx` 用户数据
- 不引入新第三方依赖

---

## 3. 改动落点

### 3.1 `agenticx/avatar/portrait.py`

锚点：L36–48 的 `_COLLECTION_BASE` / `_COLLECTION_QUERY`；L89–137 的 `infer_portrait_traits`；L191–196 的 `needs_portrait_refresh`；L321–335 的 `build_collection_portrait_url`。

**After 意图：**

```python
PORTRAIT_STYLE = "notionists-v1"
PORTRAIT_STYLE_CUSTOM = "custom"
_COLLECTION_BASE = "https://api.dicebear.com/9.x/notionists/png"
_COLLECTION_QUERY = {
    "size": "256",
    "radius": "28",
    "backgroundColor": "e8eef2,e8e8f0,ede9e3,e7efe9,efe7e9",
    "bodyIconProbability": "0",
    "gestureProbability": "0",
    "beardProbability": "8",
    "glassesProbability": "14",
}
```

`infer_portrait_traits` 改为 notionists 合法键：`hair` / `beardProbability` / `glasses` / `glassesProbability`（性别、长发/短发/眼镜映射）。删除仅服务 avataaars 的 `_infer_clothing` / `_infer_hair_color`。`build_collection_portrait_url` 只合并 notionists 合法 trait，避免把旧 `clothing`/`top` 拼进 URL。

`needs_portrait_refresh` 改为：

```python
def needs_portrait_refresh(
    avatar_url: str,
    *,
    portrait_style: str = "",
) -> bool:
    url = str(avatar_url or "").strip()
    style = str(portrait_style or "").strip()
    if not url or url.startswith("data:image/svg+xml"):
        return True
    if style == PORTRAIT_STYLE_CUSTOM:
        return False
    if style == PORTRAIT_STYLE:
        return False
    return True  # 无标记的旧 avataaars PNG 等
```

### 3.2 `agenticx/avatar/registry.py`

- `AvatarConfig`（L101 后）新增 `portrait_style: str = ""`。`from_dict` 已按字段白名单读，无需另写解析。
- `create_avatar`（L264–291）：未传入 `avatar_url` → 生成后 `portrait_style=PORTRAIT_STYLE`；传入非空 URL → `portrait_style=PORTRAIT_STYLE_CUSTOM`。
- `list_avatars` / `_ensure_portrait`（L196–225）：`needs_portrait_refresh(url, portrait_style=...)`；拉取成功后写 `portrait_style=PORTRAIT_STYLE`。
- `update_avatar`（L296–333）：在 patch 循环**之前**记下 `original_url`。若 patch 含 `avatar_url`：
  - 新值为空 → `generate_avatar_portrait_url(...)` + `portrait_style=PORTRAIT_STYLE`
  - 新值非空且 ≠ `original_url` → `portrait_style=PORTRAIT_STYLE_CUSTOM`
  - 新值与旧值相同 → 不动 style（让 list 迁移无标记旧图）

`to_dict` 的 `if v` 会自动带上非空 `portrait_style`，不必改序列化特例。

### 3.3 `tests/test_avatar_portrait.py`

现有 avataaars 断言必须改掉，否则红：

- L57 `assert "avataaars" in a` → `"notionists"`
- L136–176 服装/`top`/`accessories` 断言 → hair / glasses / beardProbability

并新增：

- `test_needs_refresh_skips_current_and_custom`
- `test_needs_refresh_migrates_unmarked_png`
- `test_list_migrates_legacy_png_and_marks_style`
- `test_create_marks_generated_and_uploaded`
- `test_update_empty_url_regenerates_line_art`
- `test_update_new_url_marks_custom`

---

## 4. Requirements

- FR-1: 新建未指定头像 → notionists 线稿（或 SVG 回退）
- AC-1: `pytest tests/test_avatar_portrait.py -q` 绿；`build_collection_portrait_url` 含 `notionists`、不含 `avataaars`
- FR-2: list 时无标记旧 PNG 被替换并写 `notionists-v1`
- AC-2: `test_list_migrates_legacy_png_and_marks_style`：mock fetch 后 `avatar_url` 与 `portrait_style` 均为新值
- FR-3: 已是 `notionists-v1` 不刷新
- AC-3: `needs_portrait_refresh(png, portrait_style="notionists-v1") is False`
- FR-4: 上传图标 `custom`，list 不覆盖
- AC-4: `needs_portrait_refresh(png, portrait_style="custom") is False`；`update_avatar` 换 URL 后 style=`custom`
- FR-5: 清空 URL 后重生成线稿
- AC-5: `update_avatar(..., {"avatar_url": ""})` 后 URL 非空且 style=`notionists-v1`

---

## 5. 验收命令

```bash
pytest tests/test_avatar_portrait.py -q
```

冷启动不改 `server.py` import，不必强制 `agx serve` smoke。画廊验收：重启 Desktop / 刷新专家列表后，原先彩色自动头像变为线稿；已是线稿的脸不变；手动上传的保持。
