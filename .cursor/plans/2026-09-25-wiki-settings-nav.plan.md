# Wiki 设置导航

Planned-with: grok-4.7
Suggested-Impl-Model: composer-2.5

## 目标

设置左侧导航在「知识库」后面增加「Wiki」。打开后先选文档型大脑，再阅读该大脑已有的 Wiki 页面。知识库详情里不再保留重复的 Wiki 标签。

## 现状

- 设置导航 id 列表在 [desktop/src/settings-tab.ts](desktop/src/settings-tab.ts) 的 `SETTINGS_TAB_IDS`（约第 16 行），`"knowledge"` 后面是 `"data_sources"`。
- 左侧图标列表在 [desktop/src/components/SettingsPanel.tsx](desktop/src/components/SettingsPanel.tsx) 的 `TAB_DEFS`（约第 1046 行）。`{ id: "knowledge", icon: Library }` 后面是 `data_sources`。标签来自 `t(\`tabs.${def.id}\`)`（约第 4950 行）。
- 知识库页是 `tab === "knowledge"` 时渲染 `KnowledgeSettings`（约第 8957 行）。`KnowledgeSettings` 只是 [desktop/src/components/settings/brains/BrainsSettings.tsx](desktop/src/components/settings/brains/BrainsSettings.tsx) 的再导出。
- `BrainsSettings` 的 `detailTabs`（约第 288 行）含 `{ id: "wiki", label: "Wiki" }`，选中时渲染 `KnowledgeWikiPanel`（约第 448 行）。
- 面板实现是 [desktop/src/components/settings/knowledge/KnowledgeWikiPanel.tsx](desktop/src/components/settings/knowledge/KnowledgeWikiPanel.tsx)。它通过 `KBApi.listWikiPages` / `getWikiPage` 读页面。API 前缀由大脑 id 拼出，后端在 [agenticx/brain/routes.py](agenticx/brain/routes.py) 第 419–431 行：`GET /api/brains/{brain_id}/wiki/pages` 与 `GET /api/brains/{brain_id}/wiki/page`。
- 中英文标签在 [desktop/locales/zh/settings.json](desktop/locales/zh/settings.json) 与 [desktop/locales/en/settings.json](desktop/locales/en/settings.json) 的 `tabs` 对象（约第 13 行 `"knowledge"`）。

## 改法

1. `SETTINGS_TAB_IDS` 在 `"knowledge"` 后插入 `"wiki"`。`TAB_DEFS` 同样插入 `{ id: "wiki", icon: BookOpen }`。`BookOpen` 从 `lucide-react` 引入；若该文件已引入则不要重复。
2. `tabs.wiki`：中文「Wiki」，英文「Wiki」。
3. 新建 `desktop/src/components/settings/knowledge/WikiNavPanel.tsx`。它调用现有 `createBrainsApi(...).list()`，只保留 `type === "docs"` 的大脑。有大脑时默认选中第一项，把对应的 `createKbApi` 传给现有 `KnowledgeWikiPanel`。没有文档型大脑时显示一句中文空状态：「还没有文档型大脑。先在知识库里创建，并打开 Wiki 编译。」不要在这个空状态里放创建大脑的表单。
4. `SettingsPanel` 在 `tab === "wiki"` 时渲染 `WikiNavPanel`，props 与 `KnowledgeSettings` 所用的 `apiToken`、`resolveApiBase` 相同。从 `SettingsPanel` 里知识库分支抄这两个值的现有取法，不要新开 token 通道。
5. 从 `BrainsSettings` 的 `detailTabs` 删除 wiki 项，并删除只为该标签存在的 `KnowledgeWikiPanel` 渲染。`DetailTab` 类型去掉 `"wiki"`。配置、资料、调试三个标签保持原顺序。

## 验收

- 设置左侧出现「Wiki」，紧挨「知识库」之后。
- 选中一个已有 Wiki 页面的文档型大脑后，页面列表和正文与原来在知识库详情里看到的一致。接口仍是 `/api/brains/{id}/wiki/pages`。
- 知识库详情里不再出现 Wiki 标签。
- 无文档型大脑时只显示上面的空状态，不发 `/wiki/pages` 请求。

## 不做

- 不改 `wiki_compiler.py`、编译接口或页面存储格式。
- 不把 Wiki 放进 `AvatarSidebar`。
- 不新增编译按钮。编译开关仍留在知识库配置里。
