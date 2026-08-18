# Desktop 团队模板成员自动创建

Planned-with: gpt5.6sol

## 目标

在 `hc-0818` 将项目群聊页的团队模板从“按关键词选择用户已有分身”的静态预填充，改为可真正创建团队的产品能力。点击模板后展示模板自带的角色；确认后为每个角色创建独立数字分身，再使用这些新分身创建智能路由群聊。除 6 个通用模板外，补充“项目材料整理”和“市场动态简报”两个轻量信息整理模板。

## 根因与证据

- `desktop/src/components/groups/group-templates.ts` 当前只有 `memberRoleHints`，文件注释明确说明模板不会创建成员。
- `ProjectsView.handleTemplateSelect()` 调用 `matchTemplateAvatarIds()`，把用户此前创建的分身塞进 `GroupEditorInline`。
- `GroupEditorInline` 本质是手动群聊编辑器，只能选择已有分身，因此模板卡片没有自己的角色、行为指令和创建流程。
- Desktop 已有 `createAvatar`、`deleteAvatar` 与 `createGroup` IPC，可在不新增底层协议的前提下完成安全编排。

## 范围

### In scope

- 为产品需求、市场调研、项目材料整理、市场动态简报、团队知识库、项目交付、缺陷验收、全栈研发 8 个模板定义 3–4 个成员。
- 每个成员包含稳定 ID、显示名、角色、简介、标签、职责、交付物及完整系统提示。
- 两个金融相邻模板只承担材料、公开信息与问题清单整理，并明确禁止估值、投决、专业尽调结论、价格预测和交易建议。
- 新建模板专属分身，`created_by` 标记为 `group_template:<template-id>`，不选择或修改用户已有分身。
- 逐步显示真实阶段和百分比；成员或群聊创建失败时回滚本次已创建分身。
- 创建成功后刷新分身和群聊列表，并打开新群聊。
- “新建群聊”和编辑已有群聊继续使用现有手动成员选择器。

### Out of scope

- 不改变群聊路由协议，仍使用 `intelligent`。
- 不自动删除已成功投入使用的模板分身；删除群聊仍沿用现有行为。
- 不为模板硬编码模型、API Key、技能启停或工作目录。
- 不把轻量信息整理模板包装为专业研究、法律/财务尽调或投资决策能力；专业知识、方法与模板仍由用户自行配置。
- 不改动工作区已有无关文件。

## 实施

### FR-1：模板成员定义

Suggested-Impl-Model: gpt5.6sol

文件：`desktop/src/components/groups/group-templates.ts`

- 用 `members: GroupTemplateMember[]` 替换 `memberRoleHints`。
- `GroupTemplateMember` 包含 `id/name/role/description/tags/systemPrompt`。
- 使用统一构造器把职责、默认交付物和群聊协作规则写成完整系统提示。
- 删除 `matchTemplateAvatarIds()`，杜绝模板路径再次选择已有分身。

AC：8 个模板均有至少 3 个成员；模板 ID、成员 ID 在各自作用域内唯一；每个成员系统提示包含职责、交付物与协作边界；两个金融相邻模板的每个成员还包含显式“能力边界”。

### FR-2：可回滚创建编排

Suggested-Impl-Model: gpt5.6sol

新文件：`desktop/src/components/groups/group-template-creation.ts`

伪代码：

```ts
for member in template.members:
  createAvatar({
    name: `${groupName} · ${member.name}`,
    role: member.role,
    description: member.description,
    tags: ["团队模板", ...member.tags],
    system_prompt: `你当前服务于「${groupName}」团队。\n\n${member.systemPrompt}`,
    created_by: `group_template:${template.id}`,
  })
createGroup({ name: groupName, avatar_ids: createdIds, routing: "intelligent" })
```

- 任一 `createAvatar` 或 `createGroup` 失败时，对 `createdIds` 调用 `deleteAvatar`。
- 回滚失败必须并入可读错误，不得静默声称已清理。
- 提供 `onProgress({ phase, completed, total, percent, message })`。
- 提供基于已有群聊名称的默认去重命名，例如第二次创建自动使用“模板名 2”。

AC：单元测试覆盖全成功、成员创建失败、群聊创建失败、回滚失败和名称去重。

### FR-3：模板确认与进度 UI

Suggested-Impl-Model: gpt5.6sol

新文件：`desktop/src/components/groups/GroupTemplateCreateDialog.tsx`

- 标题、模板描述、可编辑团队名称、模板成员卡片。
- 明确提示“将创建 N 个新分身，不会使用或修改已有分身”。
- 创建时显示当前角色/群聊/回滚阶段及真实百分比。
- 错误就地保留弹窗，取消紧邻创建按钮；运行中防止重复提交。

文件：`desktop/src/components/groups/ProjectsView.tsx`

- `handleTemplateSelect()` 不再读取 `avatars` 做角色匹配，只打开模板确认弹窗。
- 成功后使用 `mapAvatarsFromApi()` / `mapGroupsFromApi()` 刷新 Zustand。
- 优先用创建响应打开新群聊；手动创建与编辑路径保持不变。

AC：模板弹窗不渲染已有分身复选框；创建成功后新成员出现在分身列表，新群聊包含且仅包含本次创建的成员。

## 测试

- `desktop/src/components/groups/group-templates.test.ts`
- `desktop/src/components/groups/group-template-creation.test.ts`
- `desktop/src/components/groups/team-template-ui-contract.test.ts`

验证命令：

```text
cd desktop
npx --no-install vitest run src/components/groups/group-templates.test.ts src/components/groups/group-template-creation.test.ts src/components/groups/team-template-ui-contract.test.ts
npm run build
```

## 提交边界

仅暂存本计划及团队模板相关前端/测试文件，独立功能提交留在 `hc-0818`，不自动推送。
