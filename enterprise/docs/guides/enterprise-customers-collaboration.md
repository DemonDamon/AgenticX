# Enterprise ↔ Customers 协同开发手册

> 目标读者：参与 AgenticX Enterprise 开发 + 客户交付的工程师
> 版本：v0.1（2026-04-21）

---

## 1. 核心理念

```
enterprise/  是「通用产品」— 最全功能集合
customers/*/ 是「客户实例」— 挪用 enterprise 模块 + 少量定制
```

**铁律**：
1. 客户仓**只写**业务定制（规则/配置/UI覆盖），**不改** `@agenticx/*` 源码
2. 发现通用需求 → 回流到 `enterprise/`，不要在客户仓重复实现
3. 任何 commit 前，先问：「这改动会让下一个客户也受益吗？」— 会，就进 enterprise

---

## 2. 仓库布局速览

```
AgenticX/                       [public, 开源主仓]
├── enterprise/                 通用产品（和 AgenticX 同仓发布）
│   ├── apps/
│   ├── features/               ⭐ 客户挪用的主单元
│   ├── packages/
│   ├── plugins/                官方行业通用插件
│   └── docs/
└── customers/                  [gitignore 排除]
    └── client-a/               [private, 独立 git 仓]
        ├── apps/               组装壳
        ├── config/             ⭐ 白标配置
        ├── rules/              专属规则库
        ├── plugins/            客户专属插件
        └── overrides/          UI 覆盖（罕用）
```

---

## 3. 首次环境初始化

### 3.1 克隆两个仓库

```bash
# 1) 开源主仓（含 enterprise）
git clone git@github.com:your-org/AgenticX.git ~/myWork/AgenticX
cd ~/myWork/AgenticX

# 2) 客户私有仓（嵌套到 customers/<client-name>）
# customers/ 被主仓 gitignore 排除，互不干扰
git clone git@github.com:your-org/customer-client-a.git customers/<client-name>
```

### 3.2 安装依赖（从 enterprise 根目录）

```bash
cd enterprise
pnpm install
```

重点：`enterprise/pnpm-workspace.yaml` 里配置了 `../customers/*/apps/*`，
所以 **从 enterprise 运行 `pnpm install` 会同时把客户 apps 纳入 workspace**，
`workspace:*` 的跨目录引用就能正常解析。

### 3.3 启动开发

```bash
# 通用产品（演示用）
pnpm --filter @agenticx/app-web-portal dev       # :3000
pnpm --filter @agenticx/app-admin-console dev    # :3001

# 目标客户版（实际交付）
pnpm --filter @customer-client-a/portal dev      # :3100
pnpm --filter @customer-client-a/admin dev       # :3101
```

---

## 4. 四种挪用机制详解

### 机制 1：pnpm workspace 依赖（代码级挪用）

**适用场景**：客户需要 `@agenticx/feature-chat` 的完整功能，只做外层组装。

`customers/<client-name>/apps/portal/package.json`：
```json
{
  "dependencies": {
    "@agenticx/feature-chat": "workspace:*",
    "@agenticx/feature-iam": "workspace:*"
  }
}
```

`customers/<client-name>/apps/portal/src/app/page.tsx`：
```tsx
import { ChatWorkspace } from "@agenticx/feature-chat";
import { brand } from "../../../config/brand";
import { rulePacks } from "../../../rules";

export default () => (
  <ChatWorkspace brand={brand} rulePacks={rulePacks} features={features} />
);
```

---

### 机制 2：配置注入（零代码定制）

**适用场景**：品牌、色系、文案、feature flag 客户有差异。

`customers/<client-name>/config/brand.yaml`：
```yaml
brand:
  name: "客户 A 的 AI 平台"
  primary_color: "220 90% 50%"
  logo: ./assets/logo.svg
features:
  knowledge_base: true
  workflow: false
```

`@agenticx/config` 负责在启动时加载这份 YAML，通过 Context / env 下发到所有组件。

---

### 机制 3：插件覆盖（规则/工具定制）

**适用场景**：客户需要基于行业通用规则做专属扩展。

`customers/<client-name>/plugins/moderation-hc-custom/manifest.yaml`：
```yaml
name: moderation-hc-custom
type: rule-pack
extends:
  - "@agenticx/moderation-pii-baseline"
  - "@agenticx/moderation-finance"
rules:
  - id: hc-001
    name: 客户 A内部项目代号
    type: keyword-list
    source: ../../rules/keywords/project-codes.txt
    action: block
```

运行时 `@agenticx/policy-engine` 先加载 enterprise 行业包，再用客户规则覆盖。

---

### 机制 4：组件 slot 覆盖（UI 深定制）

**适用场景**：客户要求某块 UI 和通用版不一样。⚠️ 尽量避免，优先走机制 2。

enterprise 在关键位置留 slot：
```tsx
// enterprise/features/chat/src/ChatWorkspace.tsx
export function ChatWorkspace({ slots }: { slots?: { header?: ReactNode } }) {
  return (
    <div>
      {slots?.header ?? <DefaultHeader />}
      <ChatArea />
    </div>
  );
}
```

客户传入自定义组件：
```tsx
// customers/<client-name>/overrides/ClientAHeader.tsx
export const ClientAHeader = () => <header>客户专属顶栏</header>;

// customers/<client-name>/apps/portal/src/app/page.tsx
<ChatWorkspace slots={{ header: <ClientAHeader /> }} />
```

---

## 5. 需求来了怎么判断放哪

```
新需求 → 问三个问题
  ┌─────────────────────────────────────────┐
  │ 1. 至少 2 个行业客户都会要？             │
  │    → ✅ 进 enterprise/features 或 packages│
  │                                          │
  │ 2. 可以用配置/插件实现？                 │
  │    → ✅ 进 enterprise/features，做成可配置│
  │                                          │
  │ 3. 需要硬编码某客户的数据/规则？         │
  │    → ✅ 留在 customers/<name>/           │
  └─────────────────────────────────────────┘
```

---

## 6. 客户定制回流 enterprise 的流程

当你在客户仓实现了一个**明显通用**的能力，按下面流程回流：

1. 在 enterprise 侧建 issue，写清场景与通用价值
2. 把客户仓的该部分**去品牌/去规则/去机密**后抽象
3. 增加 API 使其可配置（让原客户需求也能通过配置满足）
4. 提交到 `enterprise/features/...` 或 `enterprise/packages/...`
5. 在客户仓删除原实现，改为挪用新模块
6. 写入 enterprise 的 CHANGELOG

---

## 7. 常见问题

### Q1. 客户要改 `@agenticx/feature-chat` 的某个函数怎么办？

**不要直接改**。走下面任一路径：

1. 如果能配置化（比如 "支持传 customRenderer 回调"）→ 改 enterprise 增加配置点
2. 如果真要深度改 UI → 用 slot 机制
3. 如果真要换底层逻辑 → 说明抽象不合理，抽出一个接口，客户自己实现一份注入进去

### Q2. 两个客户需要的行为冲突怎么办？

enterprise 层做成 **strategy 可替换**：
```ts
interface PolicyStrategy { check(input: string): Result; }
const strategy = config.policy.strategy === "strict" ? strictPolicy : softPolicy;
```

### Q3. 客户有紧急 bug 但涉及 enterprise 代码，怎么处理？

**不要在客户仓修补丁**。走：

1. enterprise 紧急修复（走正常 PR）
2. 客户仓 `pnpm update @agenticx/feature-xxx`
3. 重新构建、部署
4. 如实在来不及，客户仓用 `overrides/` 临时 monkey-patch，同时立刻给 enterprise 提 fix PR

### Q4. pnpm install 报 "workspace:* not found"？

检查：
1. 是否在 **enterprise/ 根目录** 运行 `pnpm install`？
2. `enterprise/pnpm-workspace.yaml` 里是否有 `../customers/*/apps/*`？
3. 客户仓的 package.json 的 `name` 是否以 `@customer-xxx/` 开头？

---

## 8. 版本策略

- `@agenticx/*` 包版本跟随 enterprise 主仓 tag
- 客户仓锁定特定版本：`"@agenticx/feature-chat": "0.5.2"`（不要用 `workspace:*` 发布到生产）
- enterprise 破坏性升级走 **0.x.0**，小改走 **0.x.y**
- 每次给客户交付前跑 `pnpm install --lockfile-only` 锁定版本，把 lockfile 提交到客户仓

---

## 9. 禁忌清单

| 禁忌 | 原因 |
|---|---|
| ❌ 在客户仓直接改 `node_modules/@agenticx/*` | 下次 install 会被覆盖 |
| ❌ 把客户规则/密钥/logo 提交到 enterprise | 开源仓会泄露客户机密 |
| ❌ 在 enterprise 硬编码 "客户 A" / 客户品牌字符串 | 下个客户无法复用 |
| ❌ 客户仓的 feature 跨越 enterprise 模块边界调用 | 紧耦合，升级断链 |
| ❌ 在客户仓 patch enterprise 的类型定义 | 混乱，应抽出接口让客户实现 |

---

## 10. 下一步

- 熟悉 `enterprise/features/chat/` 的 API
- 阅读 `enterprise/docs/plugin-protocol/` 的规则包协议规范
- 参见 `docs/plans/2026-04-21-agenticx-enterprise-architecture.md` 总架构
