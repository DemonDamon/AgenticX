---
name: favorites-item-actions
overview: 为设置面板「收藏」Tab 的每条收藏添加操作：复制、转发（复用 ForwardPicker）、编辑标签（标签展示在卡片下方）、删除。后端增加 update/delete 接口，favorites.json 数据结构增加 tags 字段。
todos:
  - id: f1
    content: "loader.py: 新增 delete_favorite / update_favorite_tags"
    status: pending
  - id: f2
    content: "server.py: 新增 DELETE /api/memory/favorites/{id} 和 PATCH /api/memory/favorites/{id}/tags"
    status: pending
  - id: f3
    content: "SettingsPanel.tsx: FavoriteRow 字段增加 tags；每条卡片加复制/转发/编辑标签/删除操作；标签 chip 展示"
    status: pending
  - id: f4
    content: SettingsPanel Props 增加 panes/avatars/groups/onForwardFavorite；App.tsx 补传
    status: pending
isProject: false
---

# 收藏条目操作功能

## 现状

`FavoritesTab` 只展示内容 + 时间，无任何操作。`favorites.json` 数据结构无 `tags` 字段。

## 变更范围

### 1. 数据结构扩展（`favorites.json` 单条）

```json
{
  "message_id": "...",
  "session_id": "...",
  "content": "...",
  "saved_at": "...",
  "role": "...",
  "tags": []
}
```

### 2. `[agenticx/workspace/loader.py](agenticx/workspace/loader.py)`

新增两个函数：

```python
def delete_favorite(workspace_dir: Path, message_id: str) -> bool:
    """Remove entry by message_id. Returns True if deleted."""
    ...

def update_favorite_tags(workspace_dir: Path, message_id: str, tags: list[str]) -> bool:
    """Set tags for a favorite by message_id. Returns True if updated."""
    ...
```

### 3. `[agenticx/studio/server.py](agenticx/studio/server.py)`

新增两个端点（在 `GET /api/memory/favorites` 附近）：

```python
DELETE /api/memory/favorites/{message_id}
  -> delete_favorite(workspace_dir, message_id)
  -> {"ok": bool}

PATCH /api/memory/favorites/{message_id}/tags
  body: {"tags": ["tag1", "tag2"]}
  -> update_favorite_tags(workspace_dir, message_id, tags)
  -> {"ok": bool}
```

import `delete_favorite`, `update_favorite_tags` from loader。

### 4. `[desktop/src/components/SettingsPanel.tsx](desktop/src/components/SettingsPanel.tsx)`

#### `FavoriteRow` 类型增加 `tags`

```ts
type FavoriteRow = {
  ...existing...
  tags?: string[];
};
```

#### `FavoritesTab` 组件改造

每条卡片下方新增操作行（4 个按钮：复制、转发、编辑标签、删除）：

- **复制**：`navigator.clipboard.writeText(content)` → 短暂显示「已复制」文案（按钮文字变化 1s）
- **转发**：打开内联 `ForwardPicker`（需从 `SettingsPanel` 的 props 传入 `panes`/`avatars`/`groups`/`onForward`，或内部调用专用简化弹窗），选中目标后调用 `POST /api/messages/forward`（已有接口）
- **编辑标签**：点击后在卡片内展开 tag 输入框（输入后 Enter 添加，点 × 删除，失焦或点保存后 `PATCH /api/memory/favorites/{id}/tags`）；标签以小 chip 展示在卡片内容下方
- **删除**：`DELETE /api/memory/favorites/{id}` → 乐观 UI（立即从列表移除，失败时恢复 + 错误提示）

#### Props 扩展（转发需要）

```ts
type Props = {
  ...existing...
  panes: ChatPane[];
  avatars: Avatar[];
  groups: GroupChat[];
  onForwardFavorite: (content: string, payload: ForwardConfirmPayload, note: string) => Promise<void>;
};
```

### 5. `[desktop/src/App.tsx](desktop/src/App.tsx)`

`SettingsPanel` 调用处补传 `panes`、`avatars`、`groups`、`onForwardFavorite`（复用已有的转发逻辑，即 `ChatPane.tsx` 中 `forwardOneMessage` 的调用链）。

> 注：`onForwardFavorite` 接收纯文本 `content`，将其包装成 `ForwardedHistoryCard` 的简单形式发送，与 `POST /api/messages/forward` 复用。

---

## 卡片 UI 布局

```
┌─────────────────────────────────────────────────┐
│ 消息内容（line-clamp-3）          2026-03-23 10:00│
│ #标签A  #标签B                                   │
│ [复制]  [转发]  [编辑标签]  [删除]  会话 bdcf…   │
└─────────────────────────────────────────────────┘
```

编辑标签展开后：

```
┌─────────────────────────────────────────────────┐
│ 消息内容                                          │
│ [标签A ×] [标签B ×]  输入新标签... [保存]         │
└─────────────────────────────────────────────────┘
```

