# Desktop 权限界面收敛与死码清理

Planned-with: Claude Opus 5
Suggested-Impl-Model: `cursor-grok-4.6-xhigh-fast`

> **依赖：** 本 plan 的 Task 2 需要 `2026-08-25-mainline-port-command-sandbox-and-permissions.plan.md`
> 的 Task 5 已落（`/api/permissions` 要先返回平台能力两字段），否则界面无从如实措辞。
> Task 1 / Task 3 / Task 4 无此依赖，可先做。
>
> 实施前把本文件移到 `.cursor/plans/` 根目录，再从 `origin/main`（或上一份 plan 的分支）开分支。

---

## 0. 基线（不要依赖对话记忆）

| 项 | 值（2026-08-25 实测） |
|---|---|
| 目标 | `origin/main`（tip `db132f40`） |
| 参考源 | `origin/hc-0818`（**只读**，禁止 merge、禁止整文件覆盖 Desktop 文件） |
| main 已有 | `desktop/src/utils/confirm-scope.ts` + `.test.ts`（来自 `f007c2c3`），`desktop/src/utils/action-confirmation.ts`，`ConfirmDialog.tsx` + `.test.tsx` |
| main 缺 | `desktop/src/utils/confirm-risk.ts`、`desktop/src/constants/confirm-strategy-options.ts` |

取参考源：

```bash
git show origin/hc-0818:desktop/src/utils/confirm-risk.ts               > /tmp/ref_confirm_risk.ts
git show origin/hc-0818:desktop/src/constants/confirm-strategy-options.ts > /tmp/ref_confirm_strategy_options.ts
git show origin/hc-0818:desktop/src/utils/confirm-scope.ts              > /tmp/ref_confirm_scope.ts   # 对照用，不要覆盖 main 版
```

> **重要：main 的 `confirm-scope.ts` 是 main 自己的实现**（91 行，`f007c2c3` 引入，配 68 行测试）。hc 版是另一条演进线。**以 main 版为基础增量修改**，把 hc 版只当参考读。

### 本 plan 要解决的三件事

1. **两套模式词汇并存。** 「确认策略（confirm strategy）」与「运行模式（run mode）」指的是同一件事，却在设置页、确认卡、store 里各说各话，用户看到两个控件不知道哪个管用。
2. **文案过度承诺。** 界面写「全部自动执行」，但高风险仍会拦（这是对的），于是文案在骗人。同理三平台的读隔离差异被抹平成一句话。
3. **Pro/Lite 双入口是死码。** `ChatView.tsx`（3049 行）等六个文件已无实际入口，却拖着每次 `ChatPane` 改动都要同步改两处。

---

## In scope / Out of scope

### In scope

- 新增 `desktop/src/utils/confirm-risk.ts`：风险等级 → 展示语义的单一映射
- 新增 `desktop/src/constants/confirm-strategy-options.ts`：模式选项的**唯一**词表
- 收敛「确认策略 / 运行模式」为一个权威字段与一个控件（设置页 + 确认卡 + store）
- 权限文案改为不过度承诺，并如实展示平台差异（消费后端两字段）
- 审批作用域绑到 task run（切任务不继承上一轮批准）

### Out of scope（严禁顺手做）

- **禁止**重写 main 的 `agenticx/runtime/confirm.py` 与 `desktop/src/utils/confirm-scope.ts` 的既有语义（低风险自动 + fail-closed 已在 main 落地，本 plan 只统一它的**表达**）
- **禁止**碰后端沙箱/权限强制层（那是姊妹 plan）
- **禁止**做设置页其他 Tab 的视觉重塑
- **禁止**碰 `enterprise/`
- **禁止**删除任何 Desktop 组件文件。Task 4（删 Pro/Lite 双入口）**已于 2026-08-25 被否决**，本 plan 全程是纯增量修改，`git diff` 里不该出现任何文件删除
- **禁止**改缓存命中率弹窗（`ContextUsagePopup.tsx`）——main 刚落，别顺手动

---

## Task 1：风险等级与模式词表的单一来源

**新增：** `desktop/src/utils/confirm-risk.ts`（参考 `/tmp/ref_confirm_risk.ts`）
**新增：** `desktop/src/constants/confirm-strategy-options.ts`（参考 `/tmp/ref_confirm_strategy_options.ts`）

### 1.1 `confirm-risk.ts`

后端 `confirm.py` 已经给出 `risk` 字段。前端需要一个**唯一**的映射把它变成展示语义：

```ts
export type ConfirmRisk = "low" | "medium" | "high" | "unknown";

/** 缺失或无法识别的 risk 一律当受保护——与后端 fail-closed 对齐。 */
export function normalizeRisk(raw: unknown): ConfirmRisk;

/** 受保护 = 不允许被"低风险自动执行"放行。 */
export function isProtectedRisk(risk: ConfirmRisk): boolean;  // low -> false，其余 true

/** 展示用：中文标签 + 主题 token 类名（不要硬编码颜色）。 */
export function riskPresentation(risk: ConfirmRisk): { label: string; className: string };
```

**颜色纪律：** 用主题层语义 token（如 `text-text-muted` / `text-amber-500` / 现有 `--ui-*` 族），**不要**硬编码 hex，也不要给「未命中/未返回」用刺眼红——那不是错误，是没数据。

### 1.2 `confirm-strategy-options.ts`

把散落的模式枚举收成一处，**这是全前端唯一的模式词表**：

```ts
export type RunMode = "ask" | "allowlist" | "auto";

export const RUN_MODE_OPTIONS: ReadonlyArray<{
  value: RunMode;
  label: string;        // 中文
  description: string;  // 中文，一句话，不得过度承诺
}> = [ /* ... */ ];
```

文案要求（逐字审）：

| value | label | description 必须表达 |
|---|---|---|
| `ask` | 每次询问 | 每一步都问 |
| `allowlist` | 白名单放行 | 名单内免问，名单外仍问 |
| `auto` | 低风险自动执行 | **明确说出高风险仍会询问** |

> `auto` 的 label **不许**写成「全部自动执行」。名字就是承诺，后端确实会拦高风险，文案必须说实话。

### AC-1

新增 `desktop/src/utils/confirm-risk.test.ts`：

1. `normalizeRisk(undefined)` / `normalizeRisk("")` / `normalizeRisk("weird")` → `"unknown"`。
2. `isProtectedRisk("low")` → `false`；`"unknown"` / `"medium"` / `"high"` → `true`。
3. `riskPresentation` 对四个值都返回非空 `label` 与非空 `className`。
4. `RUN_MODE_OPTIONS` 长度 3，`value` 无重复，每项 `description` 非空；`auto` 项的 `description` 含「高风险」字样（这条断言防止文案退回过度承诺）。

```bash
cd desktop && npx vitest run src/utils/confirm-risk.test.ts src/utils/confirm-scope.test.ts
```

main 已有的 `confirm-scope.test.ts` 必须仍全绿。

---

## Task 2：一个权威字段，一个控件

**修改：**
- `desktop/src/store.ts`（模式字段）
- `desktop/src/components/SettingsPanel.tsx`（权限区控件与文案）
- `desktop/src/components/ConfirmDialog.tsx` + `.test.tsx`（确认卡措辞）
- `desktop/src/utils/confirm-scope.ts`（消费新词表，**保留** main 既有判定逻辑）
- `desktop/src/components/ChatPane.tsx` **与** `desktop/src/components/ChatView.tsx`：两个入口都要接新词表。Task 4 已否决、双入口保留，所以只改一处会让两个入口的模式语义分叉——这正是本 plan 要消除的病

### 2.1 收敛字段

先列现状，再改：

```bash
cd desktop && grep -rn -E "confirmStrategy|confirm_strategy|runMode|run_mode|permissionMode|permissions\.mode" src/ electron/ | sort
```

**保留一个权威字段**（建议沿用后端已有的 `permissions.mode` 语义，前端字段名统一为 `runMode`），其余全部改为从它派生。**不要**留兼容别名——两套字段并存必然分叉，这正是当前 bug 的来源。

store 里的持久化要兼容旧 localStorage：读到旧字段名时迁移一次，缺省回落 `ask`（保守方向）。

### 2.2 设置页只留一个控件

权限区里若同时存在「确认策略」与「运行模式」两个选择器，**删掉一个**，保留的那个用 `RUN_MODE_OPTIONS` 渲染。

设置面板的通用纪律（沿用主线偏好）：

- 顶部与底部**不要**重复放「保存」按钮，只留底部一个；顶部可放「重置为默认」
- 「取消」紧靠「保存」左侧同排，不要被 `justify-*` 甩到对话框中间
- 面向终端用户的长段策略说明文案**删掉**，用户会自行感知
- 开关控件与设置内其他开关视觉一致，不要同屏多种控件语义混用

### 2.3 如实展示平台差异（依赖姊妹 plan Task 5）

消费 `/api/permissions` 的 `shell_read_isolation`（`full` / `none`）与 `path_deny_enforcement`（`full` / `partial` / `none`）：

| 场景 | 界面必须说 |
|---|---|
| `shell_read_isolation === "none"`（当前 Windows） | 明确说出「工作区之外的文件仍可被读取」 |
| `path_deny_enforcement === "partial"` | 说出「拒绝规则仅部分生效」，并给出原因（规则条数超限 / 平台限制） |
| 两者都 `full` | 才可以说完整隔离 |

**禁止**把两个字段合成一句话——三平台说同一句话必然有一个在过度承诺。

字段缺失（老后端）时：按最保守解读展示，不要假设 `full`。

### AC-2

1. `cd desktop && grep -rn -E "confirmStrategy|confirm_strategy" src/` → 除迁移代码外零命中。
2. `RUN_MODE_OPTIONS` 是设置页模式选项的唯一数据源（`grep -rn "低风险自动执行" src/` 只应命中常量文件）。
3. 扩 `ConfirmDialog.test.tsx`：`risk` 缺失时确认卡按受保护渲染（不出现「同类自动允许」这类可放行入口）。
4. 手测：把 mock 的 `shell_read_isolation` 设为 `none`，设置页出现「工作区之外仍可读」的提示；设为 `full` 则不出现。
5. 旧 localStorage（只有旧字段名）启动后模式不丢、不崩。

```bash
cd desktop && npx vitest run src/components/ConfirmDialog.test.tsx src/utils/confirm-scope.test.ts src/utils/confirm-risk.test.ts && npx tsc --noEmit
```

---

## Task 3：审批作用域绑到 task run

**修改：** `desktop/src/utils/confirm-scope.ts`、`desktop/src/store.ts`、`desktop/src/App.tsx`

### 根因

「本次运行内自动允许同类」若没有明确的运行边界，批准会渗到下一个任务。用户在 A 任务里批准了一次删除，B 任务不该继承。

### 改法

审批记录的 key 从 session 级下沉到 **task run 级**：新任务开始（新一轮 `/api/chat` 顶层请求）时生成新的 run 标识，审批集合随之清空。跨 run **不继承**。

同时按工作区隔离：同一分身在不同工作目录下的批准不互通（避免"在测试目录批准的 rm 到了生产目录还生效"）。

**不要**顺手改流式/中断逻辑，也不要改 `streaming-stop-policy.ts` 之外的东西。

### AC-3

扩 `desktop/src/utils/confirm-scope.test.ts`：

1. 同一 run 内第二次同类操作免问。
2 新 run 开始后同类操作**重新询问**。
3. 切换工作区后同类操作重新询问。
4. main 已有的 68 行断言一条不改、全绿。

---

## Task 4：删除 Pro/Lite 双入口 —— **不执行（2026-08-25 已否决）**

> **实施者请跳过本 Task，直接做完 Task 1–3 就收工。**
>
> 用户已在 2026-08-25 明确决定**先不删**。本节保留为记录与将来重启时的依据，
> **不是待办**。不要因为「顺手清理死码」而执行它——那正是 `no-scope-creep.mdc` 要拦的事。
>
> 相应地：`ChatView.tsx` 等六个文件在本 plan 全部 Task 完成后**仍应存在**（见 AC-G9）。
> Task 2 的词表收敛因此必须**同时覆盖 `ChatPane.tsx` 与 `ChatView.tsx` 两个入口**，
> 不能只改一处，否则两个入口的模式语义会分叉。
>
> 将来若要重启此项，需用户重新放行，并按下述证据链先验证死码判定。

### 删除清单（源分支 `3c258bbc` 的对应改动，共 −3622 行）

| 文件 | 行数 |
|---|---|
| `desktop/src/components/ChatView.tsx` | 3049 |
| `desktop/src/components/SubAgentPanel.tsx` | 77 |
| `desktop/src/components/CommandPalette.tsx` | 82 |
| `desktop/src/components/LiteChatView.tsx` | 38 |
| `desktop/src/components/QuickActions.tsx` | 28 |
| `desktop/src/components/ShortcutHints.tsx` | 12 |
| `desktop/src/core/command-registry.ts` | 164 |

连带修改：`desktop/src/App.tsx`、`ChatPane.tsx`、`KeybindingsPanel.tsx`、`core/keybinding-manager.ts`、`store.ts`、`electron/main.ts`、`electron/preload.ts`、`global.d.ts`。

### 顺序要求

**必须在 Task 1–3 之后做。** 原因：源分支上 `cf795caf`（模式词表收敛）**修改过** `ChatView.tsx` 与 `command-registry.ts`，之后 `3c258bbc` 才删掉它们。先做词表收敛（Task 2）能保证两个入口语义一致，万一 Task 4 被否决，留下的 `ChatView` 也不是半旧半新的状态。

### 删除前的证据链（不许凭感觉删）

```bash
cd desktop
for f in ChatView LiteChatView CommandPalette QuickActions ShortcutHints SubAgentPanel; do
  echo "== $f"; grep -rn "$f" src/ electron/ --include='*.ts*' | grep -v "components/$f.tsx"
done
grep -rn "command-registry\|commandRegistry" src/ electron/
```

逐条确认每个引用点都能安全移除（是死路径，不是"暂时没人调"）。**任何一条无法判定就停下问用户**，不要猜。

`keybinding-manager.ts` 里绑定到被删组件的快捷键要一并摘掉，并扩 `core/keybinding-manager.test.ts` 断言剩余绑定表不含悬空 action。

### AC-4

1. `cd desktop && npx tsc --noEmit` → 0 error。
2. `npx vitest run` → 全绿（含 `keybinding-manager.test.ts`）。
3. `npm run build` 成功。
4. 手测：启动 Desktop，主聊天、多窗格、群聊、设置、工作区面板、终端全部可用；快捷键面板里没有指向已删组件的条目。
5. `git diff --stat` 中删除行数与上表相符（防止误删相邻文件）。

---

## 提交分组

```
feat(desktop): one vocabulary for run modes and confirmation risk
fix(desktop): say what the permission modes actually do
fix(desktop): scope approvals to the current task run
```

（Task 4 已否决，无第四个 commit。）

trailer（顺序固定，只许这五个）：

```
Plan-Id: 2026-08-25-desktop-permission-ui-consolidation
Plan-File: .cursor/plans/2026-08-25-desktop-permission-ui-consolidation.plan.md
Plan-Model: Claude Opus 5
Impl-Model: cursor-grok-4.6-xhigh-fast
Made-with: Damon Li
```

若实际实施换了模型，`Impl-Model` 以实际使用为准，不要照抄本行。

subject/body 禁止客户名、第三方产品名与对标措辞。

---

## 总验收

| ID | 断言 |
|---|---|
| AC-G1 | 前端只有一套模式词表，设置页只有一个模式控件 |
| AC-G2 | `auto` 模式的界面文案明确说出高风险仍会询问 |
| AC-G3 | `risk` 缺失时前端按受保护渲染（与后端 fail-closed 一致） |
| AC-G4 | Windows（`shell_read_isolation === "none"`）时界面明说工作区外仍可读 |
| AC-G5 | `path_deny_enforcement === "partial"` 时界面说出原因 |
| AC-G6 | 新 task run 不继承上一轮批准；跨工作区不继承 |
| AC-G7 | main 已有 `confirm-scope.test.ts` / `ConfirmDialog.test.tsx` 断言未被删改且全绿 |
| AC-G8 | `npx tsc --noEmit` 与 `npm run build` 通过 |
| AC-G9 | 六个 Pro/Lite 组件文件**仍然存在**（Task 4 已否决），且 `ChatPane.tsx` 与 `ChatView.tsx` 两个入口的模式语义一致 |
| AC-G10 | `git diff --stat origin/main..HEAD` 中无任何文件删除 |

---

## 已知限制（验收时不得粉饰）

1. **Windows 读隔离缺失是真实缺口**，本 plan 只是让界面不再隐瞒它，不修它。
2. **`partial` 的降级原因目前只有两类**（平台限制 / 规则条数超限）。后端将来加新原因时，界面文案要跟着扩，不要写死成两句。
3. **双入口仍在。** Task 4 已否决，`ChatPane.tsx` 与 `ChatView.tsx` 继续并存，本 plan 之后每次改模式相关逻辑仍要同步两处。这是已知的维护成本，不是遗漏。
