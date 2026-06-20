# Enterprise 消息列表：拖选文字误触多选修复

## 问题

用户在 Enterprise 聊天中仅拖选消息内文字，即弹出「已选择 1 条消息 / 全选 / 复制文本」多选 UI。

## 根因

`MessageList` 在消息行 `onPointerDown` 启动 500ms 长按计时器；鼠标拖选文字时常超过 500ms，误触发 `handleLongPress` 进入多选模式。

## 方案

- 桌面 `pointerType === "mouse"` 不启动长按计时器
- 触控长按在指针移动超过 8px 时取消（滚动/拖选）
- 进入多选前检测 `window.getSelection()`，有选中文本则跳过
- 桌面保留消息操作栏「多选」按钮作为显式入口（对齐 Near Desktop）

## 验收

- AC-1: 鼠标拖选消息文字不进入多选模式
- AC-2: 点击消息操作「多选」可正常进入多选
- AC-3: 触控长按（无位移）仍可进入多选
