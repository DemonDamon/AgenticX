---
name: 组织页与用户页新建用户流程统一
overview: 把组织页新建用户与用户页使用的入口、字段和提交逻辑统一，创建时继承当前部门，并提供默认关闭的管理员角色勾选。
todos:
  - id: t1-shared-create-dialog
    content: 抽取共享新建用户弹窗，统一部门、基础资料、密码和管理员勾选字段
    status: completed
  - id: t2-organization-entry
    content: 组织页新增用户按钮并默认带入当前组织部门
    status: completed
  - id: t3-user-entry
    content: 用户页入口迁移到共享弹窗，移除旧的新建用户表单分叉
    status: completed
  - id: t4-admin-role-backend
    content: 管理员勾选映射 admin 角色，并确保系统角色存在
    status: completed
  - id: t5-tests
    content: 验证组织部门继承、管理员 payload 和后台构建
    status: completed
isProject: false
---

# 组织页与用户页新建用户流程统一

**Planned-with**: gpt-5.6-terra
**Suggested-Impl-Model**: gpt-5.6-terra
**Plan-Id**: 2026-08-01-organization-user-create-unification
**Plan-File**: `.cursor/plans/2026-08-01-organization-user-create-unification.plan.md`

## 根因与证据

- `/iam/bulk-import` 的 `OrganizationEditor` 目前只有新增组织/成员移动能力，组织入口与用户入口没有共享的新建用户组件。
- `/iam/roles` 仍保留一套旧的新建用户弹窗，只提交基础资料和 `roleCodes: ["member"]`，没有部门选择，也无法给新用户分配管理员角色。
- `/iam/users` 另有一套 `UserFormDialog`，字段和角色选择方式与 `/iam/roles` 不一致，造成从组织入口跳入旧页面或新建后部门未继承。
- 后端 `POST /api/admin/users` 已支持 `deptId` 和 `roleCodes`，但创建前没有保证系统角色种子存在；管理员勾选需要稳定映射到 `admin` 角色。

## 目标与边界

### In scope

1. 新增共享新建用户弹窗，组织页和用户页共用同一套字段、校验、提交、初始密码展示和管理员勾选。
2. 组织页在当前组织编辑区域提供“新建用户”，打开时默认选中当前组织；提交 `deptId`，让用户直接继承该部门的组织范围。
3. 管理员选项只显示一个名为“管理员”的复选框，默认不勾选；勾选提交 `member + admin`，未勾选只提交 `member`。
4. 后端创建用户前确保系统角色存在，兼容 PostgreSQL / MySQL。

### Out of scope

- 不修改已有用户编辑、部门移动、批量导入字段协议。
- 不把 `super_admin` 权限暴露给新建用户；“管理员”只对应现有 `admin` 系统角色。
- 不修改桌面端、聊天中断或 Token 配额逻辑。

## 验收标准

- 组织页和用户页打开的是同一个新建用户组件，不再跳转旧页面。
- 从组织“新建用户”打开时，部门默认是当前组织；提交后 API payload 含当前 `deptId`。
- 管理员复选框初始为未勾选；勾选后新用户角色为 `admin` + `member`，未勾选仅为 `member`。
- 用户仍能使用自动生成初始密码，创建成功后可复制；组织页创建后成员列表刷新。
- admin-console 定向类型检查/构建或可执行的测试通过，变更只包含本功能文件及计划文件。
