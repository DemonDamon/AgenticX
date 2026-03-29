---
name: 用户档案与偏好设置
overview: 将「群内显示名称」升级为全局「我的档案」设置模块，新增自由文本「个人偏好/风格说明」字段，存入 localStorage 并随每次请求传到后端，注入到所有 agent 系统提示末尾。
todos:
  - id: store
    content: store.ts：重命名 userDisplayName→userNickname，新增 userPreference 字段与 localStorage 持久化
    status: completed
  - id: settings-ui
    content: SettingsPanel.tsx：新增「我的档案」Panel，移入称呼字段，新增偏好 textarea
    status: completed
  - id: request-body
    content: ChatPane.tsx / ChatView.tsx：构造请求时携带 user_preference；所有 userDisplayName 引用改为 userNickname
    status: completed
  - id: protocol
    content: protocols.py：ChatRequest 新增 user_nickname / user_preference 字段
    status: completed
  - id: server
    content: server.py：从 payload 取字段，传给 build_meta_agent_system_prompt
    status: completed
  - id: prompt
    content: meta_agent.py：新增 _build_user_profile_block()，注入到系统提示末尾
    status: completed
---

# 用户档案与偏好注入方案

## 数据流

```mermaid
flowchart LR
    subgraph Desktop
        A["「我的档案」设置面板\nuserNickname + userPreference"]
        B["store.ts\nuserNickname / userPreference\n(localStorage 持久化)"]
        C["每次 /api/chat 请求\n传 user_nickname + user_preference"]
    end
    subgraph Backend
        D["server.py 接收\n注入 _build_user_profile_block()"]
        E["meta_agent.py\nbuild_meta_agent_system_prompt()"]
        F["LLM 系统提示末尾\n## 用户档案与偏好"]
    end
    A --> B --> C --> D --> E --> F
```

## 改动文件与内容

### 1. `desktop/src/store.ts`

- `userNickname: string` — 原 `userDisplayName` 重命名，兼容旧 localStorage key（`agx-user-display-name`），群聊 + 单聊均使用
- `userPreference: string` — 新增，存入 key `agx-user-preference`，上限 500 字

### 2. `desktop/src/components/SettingsPanel.tsx`

在「显示」Panel 下方、「权限」Panel 上方，新增 **「我的档案」** Panel：

- **我的称呼**：原「群内显示名称」移入，label 为「我的称呼（用于所有对话）」
- **个人偏好**：`<textarea>` rows=4，maxLength=500，实时保存到 store
- 删除原「显示」Panel 里的「群内显示名称」input

### 3. `desktop/src/components/ChatPane.tsx`

- 使用 `userNickname` / `userPreference`
- 请求 body 附带 `user_nickname`、`user_preference`（单聊与群聊）

### 4. `agenticx/studio/protocols.py`

`ChatRequest` 新增：

- `user_nickname: Optional[str] = None`
- `user_preference: Optional[str] = None`

### 5. `agenticx/studio/server.py`

从 payload 读取并传入 `build_meta_agent_system_prompt(..., user_nickname=..., user_preference=...)`。

### 6. `agenticx/runtime/prompts/meta_agent.py`

新增 `_build_user_profile_block(nickname, preference)`，在 `build_meta_agent_system_prompt` 末尾、`MetaSkillInjector().inject(...)` 之前追加到 `base_prompt`。

### 7. `agenticx/runtime/group_router.py`（可选）

群聊子 agent 系统提示可后续扩展传入 preference；首版以 Meta-Agent 路径注入为主。

---

## 关键约束

- `userPreference` 不写入服务器磁盘配置，仅 localStorage + 请求 body
- 上限 500 字，防止超大系统提示
- 字段均可选，空值时不注入对应 block

---

## 实现结论

- 代码已合入：`236a0a1`（feat(desktop+backend): 用户档案与个人偏好全局注入）。
- 与草案差异：`run_group_turn` 未新增 `user_preference` 参数；`meta_agent` 中称呼行文案含「禁止省略」等强化表述；`user_nickname` 仅在非默认「我」时由前端发送。
