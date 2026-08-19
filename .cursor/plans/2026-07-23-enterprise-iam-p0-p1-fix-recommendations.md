# Enterprise IAM 与聊天问题修改建议

Planned-with: GPT-5

Status: 建议文档，仅用于评审；本次不修改代码、不提交实现。

## 1. 依据与边界

本建议同时依据以下证据：

- `docs/concepts/agent.md`：AgentRuntime 的 think-act loop、流式事件、超时、取消/错误终止语义。聊天中断的修复必须保持 `ERROR`/`FINAL`/部分结果的事件边界，不能把用户取消误报成模型失败。
- Enterprise 源码：`enterprise/apps/admin-console`、`enterprise/features/chat`、`enterprise/packages/sdk-ts`、`enterprise/packages/iam-core`。
- 内部 Bug 表中已标记为 P0 的记录，以及用户提供的 7 张 IAM 截图。截图中的邮箱、账号等仅作为复现数据，不写入实现或对外文案。

In scope：Enterprise admin-console 的部门/用户/模型可见性，以及 web-portal 聊天取消与恢复行为；配套 API、IAM store、SDK 和自动化测试。

Out of scope：Desktop、`agenticx/studio/server.py`、客户品牌/文案、数据库迁移、未在截图或 P0/P1 记录中出现的权限模型重构。

实施顺序：P0-1 → P0-2 → P0-3 → P0-4；每个 P0 独立通过测试后再处理 P1。建议模型：P0-1/2/3 使用 Composer 2.5 级别的代码模型即可；P0-4 涉及 SDK、SSE、状态机和 AgentRuntime 语义，使用代码专长中档模型并由强推理模型做收口复核。

## 2. P0（必须优先修复）

### P0-1 组织图缺少“总部”，节点/层级操作语义不清

现象：截图 2、4 的左侧从“平台研发部”开始，最高层级“总部”未显示在组织图；截图 2、3 中右侧部门/成员卡片看起来像可进入的层级，但成员行无可操作反馈。P0 记录还描述组织图中的层级节点不可点击。

证据链：

1. `enterprise/packages/iam-core/src/repos/departments.ts:~83-108` 的 `listDepartmentsTree` 直接返回 `parentId = null` 的真实部门，未构造组织根节点。
2. `enterprise/apps/admin-console/src/app/iam/departments/page.tsx:305-307` 将 `currentDeptId === null` 解释为 Root；`689-738` 只循环 `tree`，因此 Root 是一个页面状态，不是可在树中定位的“总部”节点。
3. 同文件 `616-646` 的直属成员使用无 `onClick` 的 `<div>`，而 `648-671` 子部门行才绑定点击，导致用户对“成员可管理/可进入”的预期落空。

建议改动：

- 在 `mapApiToNode`/树数据装配处增加明确的展示根节点（例如 `kind: "org-root"`、稳定的 `id`，不伪造数据库部门）；Root/总部只负责承载顶级部门，不参与部门 DELETE、模型配置或成员归属。
- 在 `TreeNode` 和右侧 Root 卡片中显式区分“展开/选中”两个操作：节点名称区域负责选中，Chevron 负责展开；所有可进入卡片使用 `<button>` 或带 `role="button"`、键盘事件、焦点态的语义控件。
- 直属成员行改为可点击的用户入口，跳转 `/iam/users?dept=<currentDeptId>&user=<member.id>` 或打开用户详情；行末提供明确的“管理成员”入口。删除部门仍只能删除部门，不能让红色删除图标被误解为删除员工。
- 根节点不允许删除；部门删除失败时保留后端 `dept_has_children`/`dept_has_members` 的 409 语义，并在当前卡片附近提示下一步操作。

Before/after 意图：

```text
Before: currentDeptId === null => Root 页面；tree.map(topLevel)；成员行是普通 div。
After: 组织树 = [OrgRoot(总部, virtual), ...realDepartments]；OrgRoot 只可选中/展开；成员行 => openUser(member.id)；部门删除按钮仅出现在 real department。
```

验收标准（AC）：

- `enterprise/apps/admin-console/src/app/iam/departments/page.test.tsx`：用“总部 → 平台研发部 → AI研发部 → 开发部 → 第一组”树数据渲染，断言“总部”可见、Root 选中不发 DELETE、顶级部门仍可展开。
- 同一测试断言点击成员“WindowsAdmin1”调用用户详情/用户过滤回调，点击子部门只切换部门；键盘 Enter/Space 与鼠标行为一致。
- `enterprise/packages/iam-core/src/__tests__/departments-repo.test.ts`：断言数据库树接口仍只返回真实部门，虚拟根不写入数据库，避免污染 `path` 和唯一约束。
- 手工回归：截图 2 的每一级节点均可选中；截图 3 的成员行有即时反馈；导出结构仍使用真实部门路径。

### P0-2 Locked 用户仍可删除

现象：用户状态为 Locked 时仍能看到并触发 Delete，用户反馈“依然可以被删掉”。截图 7 的详情 Sheet 底部始终显示红色删除按钮。

证据链：

1. `enterprise/apps/admin-console/src/app/iam/users/page.tsx:638-656` 无条件渲染 Delete 按钮。
2. 同文件 `247-258` 的 `handleDelete` 只做通用确认，不判断 `user.status`。
3. `enterprise/apps/admin-console/src/app/api/admin/users/[id]/route.ts:58-69` DELETE 直接调用 `softDeleteUser`，没有 Locked/Disabled 状态保护；因此即使前端隐藏按钮，直接调用 API 仍可能删除。

建议改动：

- 先在 API 层加不可绕过的状态策略：读取目标用户后，若 `status === "locked"`，返回稳定错误码（建议 `409 user_locked_cannot_delete`）和可读消息；不要把 Locked 自动转成 Disabled 或直接软删除。
- `page.tsx` 的列表菜单、详情 Sheet、批量/快捷动作统一使用 `canDeleteUser(user)`；Locked 用户显示“先解锁/联系管理员”而不是可点击 Delete。状态判断必须集中在一个纯函数，避免列表与详情分叉。
- 若业务确实需要删除 Locked 用户，必须先显式解锁并再次确认；本 P0 建议默认采用“禁止直接删除”，不扩展为新的解锁流程。

Before/after 意图：

```text
Before: DELETE => softDeleteUser(tenant,id,actor)；UI 始终显示 Delete。
After: DELETE => getAdminUser -> if locked return 409 -> else softDeleteUser；UI locked 不渲染 Delete，直接 API 也得到同一 409。
```

AC：

- `enterprise/apps/admin-console/src/app/api/admin/users/[id]/route.test.ts`：构造 `locked` 用户，DELETE 断言 HTTP 409、错误码 `user_locked_cannot_delete`，并断言 `softDeleteUser` 未调用。
- 同文件测试 `active`、`disabled` 用户仍按现有权限成功软删除，并保留审计 actor。
- `enterprise/apps/admin-console/src/app/iam/users/page.test.tsx`：Locked 用户列表菜单和详情 Sheet 均不存在可点击 Delete；Active 用户仍存在。
- 浏览器回归：即使手工向 DELETE 发请求，Locked 用户状态与列表记录不变；不能只依赖前端隐藏按钮。

### P0-3 部门/角色模型可见性继承失效，子部门收到空集合

现象：P0 记录描述“导入用户后为角色设置部门可用模型时，角色自身可用模型为 0，需要手动授权；父组织模型可用性没有继承到子级；继承按钮无响应”。这与截图中层级语义模糊相互放大：管理员无法判断当前配置的是部门、角色还是用户。

代码证据：

- `enterprise/apps/admin-console/src/lib/db-stores/postgresql/dept-models-store.ts:52-68,81-103` 只计算 `parentAllowedIds` 并在 `setDeptModels` 中通过 `clipToAllowed` 裁剪；没有“继承”写入动作。
- `enterprise/apps/admin-console/src/components/visible-models-editor.tsx:86-156,167-180` 只提供模型勾选和 PUT 保存；父级模型在 `parentAllowedSet` 中表现为禁用条件，不存在可验证的继承操作或成功回填。
- `enterprise/apps/admin-console/src/lib/db-stores/postgresql/user-models-store.ts:62-96` 对无部门用户直接返回全量 enabled，对有部门用户按祖先链计算；这与“角色/部门继承”不是同一个数据层，容易出现显示成功但有效集合为 0。

建议改动：

- 先明确数据契约：部门模型采用 `inherit | explicit` 两态；`inherit` 不写一份复制快照，而是沿祖先链实时求并集/交集（按现有安全策略选择“父级允许集合”作为上限）；`explicit` 只保存管理员勾选的子集。
- 将“继承”变成真实 API：例如 `PUT /api/admin/departments/:id/models {mode:"inherit"}`，返回 `mode`、`effectiveModelIds`、`sourceDeptId/sourcePath`；按钮成功后重新 GET，禁止只改本地 state。
- 在 `readDeptEditPayload`、`setDeptModels` 与 MySQL 对等实现同步契约；`visible-models-editor.tsx` 展示“继承自：总部/部门路径”“当前有效 N 个，显式配置 M 个”，空集合时给出阻断原因。
- 角色侧若要继承部门模型，必须由角色→部门/用户的明确关联接口计算 effective set；不要在 UI 中把 `parentAllowedIds` 直接当成角色自身已保存模型。

AC：

- 扩展 `enterprise/apps/admin-console/src/lib/__tests__/dept-models-store.test.ts`：父部门有 `a/b`、子部门无显式配置时，读取返回 `mode=inherit`、`effectiveModelIds=[a/b]`；父部门新增/删除模型后子部门下一次 GET 跟随变化。
- 新增 `enterprise/apps/admin-console/src/app/api/admin/departments/[id]/models/route.test.ts`：PUT `mode=inherit` 真正持久化继承状态；重复 PUT 幂等；无权限返回 403；无父级时返回全量 enabled 而非空集合。
- 扩展 `enterprise/apps/admin-console/src/components/visible-models-editor.test.tsx`：点击继承后按钮进入 loading，成功 GET 后显示来源和有效数量；网络 500 时保留原选择并就近 toast。
- 新增用户/角色有效模型集成测试：父级可用模型存在时，导入用户后的首次读取不为 0；调用聊天模型白名单校验只能放行 effective set 内模型。

## 3. P0-4 对话中断后被误判为失败/后续对话异常

现象：P0 记录描述部分模型（如记录中提到的 gpt5.4nano、DeepSeek V4 flash）中断后内容被截断且没有正确撤回，之后普通追问也可能继续显示同一异常；其他模型未稳定复现。该问题属于跨层流式状态问题，不能只改按钮文案。

代码证据：

- `enterprise/features/chat/src/store.ts:694-922,1495-1502`：取消依赖 SDK `cancel(requestId)`，流循环用 `chunk.cancelled` 清理状态；只有 `status !== "error" && hydrated` 才持久化部分 assistant。
- `enterprise/packages/sdk-ts/src/chat/http.ts:35-47,70-217,232-235`：每个请求有 AbortController；Abort 后依赖 `pending.cancelled` 将异常映射为 `cancelled`。网关路由 `enterprise/apps/web-portal/src/app/api/chat/completions/route.ts` 直接透传上游 body，没有统一的取消帧/finish_reason 归一化。
- `docs/concepts/agent.md` 要求终止事件区分 `ERROR` 与用户停止，部分结果可保留；因此“取消”不能走普通 error 分支，也不能让下一轮复用旧 active request。

建议改动：

- 为每个 session 引入不可复用的 `requestId`/generation token；`sendMessage` 的每个 chunk 先校验仍是当前请求，旧流到达时丢弃，避免取消后尾包覆盖下一轮。
- SDK 在 `AbortError`、上游 `finish_reason=length`、显式用户 cancel 三种情况分别产出稳定 chunk：`cancelled`、`truncated`、`error`，并在 finally 清理 pending/controller；不要用一个“截断字符串”复用三种语义。
- Store 的 cancel 流程应先乐观设置 session 为 idle、保存已生成部分，再调用 SDK cancel；下一条消息使用全新 requestId，并把“上一轮 query + 已生成部分 + 新 query”作为延续上下文（若产品选择撤回，则明确从历史中移除 partial，而不是半撤回）。
- 网关增加客户端断开/取消时的上游 context cancel 和可观测日志，区分用户取消、模型自然结束、超时、策略拦截。

AC：

- 保留并扩展 `enterprise/features/chat/src/store.interrupt.test.ts`：取消后 partial assistant 只持久化一次，状态为 idle、无 error；紧随发送的新请求不被旧流的尾帧改写。
- 新增 `enterprise/packages/sdk-ts/src/chat/http.interrupt.test.ts`：模拟 AbortError、SSE `[DONE]`、`finish_reason=length`，分别断言 `cancelled`/正常完成/`truncated`，且 controller/pending map 清空。
- 新增 `enterprise/apps/web-portal/src/app/api/chat/completions/route.interrupt.test.ts` 或 gateway 集成测试：客户端断开后上游请求收到取消；服务端不会把取消包装成 500。
- 按模型矩阵复现：同一 session 依次执行“长回答 → 取消 → 普通短问题”，验证 gpt5.4nano、DeepSeek V4 flash、Sonnet5、GLM5.2 的状态和历史一致；断言第二问不含第一问残留的错误提示。

## 4. P1（建议修复，不阻塞 P0）

### P1-1 从当前部门创建用户时默认带入部门

截图 1 说明创建成功后才显示一次性密码；截图 3 的部门入口已有当前 `currentDeptId`。但 `enterprise/apps/admin-console/src/app/iam/users/page.tsx` 使用 `EMPTY_USER_FORM.deptId = ""`，而 `?dept=<id>` 仅用于 `deptFilter`，没有进入创建表单。建议在 `searchParams` 初始化 `createInitialDeptId`，打开创建弹窗时传入；保存前仍由 API 校验部门存在。AC：从“第一组”点击新建，Department 默认第一组；从全局 Users 新建保持 Unassigned。

### P1-2 角色/部门选择的层级表达改为可读树

`departments/page.tsx:309-319` 使用重复 `—` 作为层级缩进；用户截图中角色/部门选择容易误判父子关系。建议改为带展开状态的 tree select，选项展示“部门名 + 完整 path”，父节点与叶子节点有不同图标，禁止把 path 文本当可点击层级。AC：五级路径中每级可区分，键盘导航可回到父级。

### P1-3 无部门用户创建成功后再报错

`user-models-store.ts:62-70` 将无部门用户的 parentAllowedIds 设为全量 enabled；创建/模型配置/网关校验对“未分配部门”应采用同一策略。建议在 `POST /api/admin/users` 与 `UserFormDialog` 明确“未分配部门允许创建，但不能使用部门继承配置”，或者将部门设为必填；二选一后统一 API、UI、聊天白名单。AC：创建、编辑、首次聊天三处不出现互相矛盾的成功/报错。

### P1-4 部门内员工不可直接管理

成员行 `departments/page.tsx:626-646` 没有点击事件，也没有批量选择；部门删除只能操作部门。建议提供“查看用户”“移出部门”“批量管理”入口，移出操作调用用户 PATCH 而不是 DELETE 部门。AC：单击员工可打开详情，移出后部门成员数和 Users 过滤结果同步。

### P1-5 部门 path 展示统一

截图 5 的路径带 `/总部/.../第一组/`，而树接口由真实根部门直接生成 `/${name}/`（`departments.ts:140-147`）。建议 UI 统一使用“虚拟总部 + 真实 path”展示格式，数据库 path 保持现有兼容格式；所有面包屑、用户详情、模型来源标签共用一个 `formatDepartmentPath`。AC：同一部门在树、用户详情、模型配置、导出 CSV 的名称和层级一致。

### P1-6 编辑用户不再先开编辑表单、再开详情 Sheet

当前 `users/page.tsx:454-467` 行点击打开详情，详情底部 Edit（`638-642`）再切到 `UserFormDialog`，形成截图 6→7 的顺序跳转。建议编辑动作直接打开一个可保存的详情编辑页；保存成功后回到详情，失败时保留表单并显示 API 原因。AC：点击 Edit 只出现一个 Dialog/Sheet，保存后字段、状态、部门、角色立即回显，刷新后仍一致。

## 5. 实施与回归门槛

1. 先补 P0 测试和错误码契约，再实现；P0 每项独立提交，避免把 P1 UI 重构混入权限/流式修复。
2. admin-console 变更至少运行对应 Vitest、`typecheck`、`build`；聊天 SDK/feature 同样运行 package tests 与 portal build。
3. 任何触碰 `agenticx/studio/server.py` 的实现另按仓库规则执行冷启动 smoke test；本建议明确不涉及该文件。
4. 验收记录必须包含：复现数据、请求/响应状态码、数据库是否写入、刷新/重启后的结果，以及截图对应的 UI 状态。
