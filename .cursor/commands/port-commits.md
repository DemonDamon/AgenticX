# port-commits

把**已落地、可追溯**的一组 commit，用 **cherry-pick（最稳妥）** 同步到目标分支（常见：`main` → `hc-0730`）。

与 `/port-from-branch` 的区别：

| 指令 | 场景 | 默认动作 |
|---|---|---|
| `/port-from-branch` | 参考协作者分支，在 main 上核实后**更瘦重做** | 禁止整包盲合 |
| `/port-commits` | 源分支上的改动**已经定稿**，要原样/按序搬到目标分支 | **只 cherry-pick 选定 commits**，默认不 `merge` 整支 |

## 参数（从 `$input` 解析）

写法宽松：空格分隔的 token + 可选 `--key=value`。缺关键参数时**先问用户再动手**，不要猜错目标分支。

### 必选

- `--to=<目标分支>`：要接收改动的分支，如 `hc-0730`  
  - 也可写成自然语言：`合并到 hc-0730` / `同步到分支A`

### 选定要搬的 commits（四选一，可组合）

按优先级解析；最终必须解析出**有序 commit 列表**（旧 → 新）：

1. **显式 SHA**（最稳）  
   - 例：`/port-commits a1b2c3d e4f5g6h --to=hc-0730`  
   - 支持短 SHA（≥7）与完整 SHA；解析后用 `git rev-parse` 校验存在。

2. **Plan-Id 检索**（推荐给本仓库带 trailer 的提交）  
   - `--plan-id=<id>`  
   - 例：`/port-commits --plan-id=2026-07-27-enterprise-portal-web-search-wiring --to=hc-0730`  
   - 在 `--from`（默认 `origin/main`）历史上：  
     `git log <from> --grep='Plan-Id: <id>' --reverse --format='%H'`  
   - 可同时给多个：`--plan-id=A --plan-id=B`（先 A 再 B，各自内部按时间旧→新）。

3. **源分支 + 最近 N 次**  
   - `--from=<源分支>`（默认 `origin/main`）  
   - `--last=<N>` 或自然语言「最近两次 / 最近 2 个提交 / last 2」  
   - 例：`/port-commits --from=main --last=2 --to=hc-0730`  
   - 「最近 N 次」= `git log <from> -N --reverse --format='%H'`（**不是**相对目标分支的 diff，而是源分支 tip 往回数 N 个）。  
   - 若用户说「main 上比 hc-0730 多出来的最近两次」，改用：  
     `git log origin/hc-0730..origin/main -2 --reverse`（见下方「相对范围」）。

4. **相对范围**  
   - `--range=<A>..<B>` 或 `--range=<A>...<B>`  
   - 例：`/port-commits --range=origin/hc-0730..origin/main --to=hc-0730`  
   - 若再带 `--last=N`：在该范围内取最新 N 个，再 `--reverse` 成旧→新。

### 可选开关

| 开关 | 含义 | 默认 |
|---|---|---|
| `--from=<ref>` | 检索 Plan-Id / last N 时的源 tip | `origin/main` |
| `--dry-run` | 只列将要拣的 commits + 文件面，不改分支 | **默认开启**（未写 `--apply` 即 dry-run） |
| `--apply` | 真正 checkout 目标分支并 cherry-pick | 关 |
| `--push` | apply 成功后 `git push -u origin <to>` | 关（需用户明确，或与 `--apply` 同写才推） |
| `--allow-empty-skip` | cherry-pick 空提交（已包含）时跳过并继续 | **开** |
| `--strategy=merge` | **不推荐**；仅当用户显式要求整支 merge 时才用，并先警告风险 | cherry-pick |

### 参数示例（推荐记这几条）

```text
# 1) 最稳：给你 SHA
/port-commits 01ac3fc9 --to=hc-0730 --apply --push

# 2) 按 Plan-Id（实施完后最省事）
/port-commits --plan-id=2026-07-27-enterprise-portal-web-search-wiring --to=hc-0730 --apply

# 3) 模糊「最近两次」（源默认 main tip）
/port-commits 最近两次 --to=hc-0730
/port-commits --from=main --last=2 --to=hc-0730 --apply

# 4) 「main 相对客户分支多出来的」整段预览
/port-commits --range=origin/hc-0730..origin/main --to=hc-0730

# 5) 自然语言混写
/port-commits 把 main 上 Plan-Id 为 xxx 的提交同步到 hc-0730，先预览
```

## 为什么默认 cherry-pick（最稳妥）

客户分支（如 `hc-0730`）常有定制与 `main` 分叉。`git merge origin/main` 会把中间所有无关 commit 一并带入，冲突面大、回滚难。

**cherry-pick 有序 SHA 列表**只搬选定能力，冲突面可控、可用 `Plan-Id` 追溯、失败可单笔 `cherry-pick --abort`。

整支 `merge` 仅在用户显式 `--strategy=merge` 且确认「目标分支愿意吸收源分支全部历史」时执行。

## 模型约束

若需 subagent 处理冲突分析：默认只用 `composer-2.5-fast` 或 `cursor-grok-4.5-high-fast`。不可用则主 agent 串行，并在报告说明。

## 执行流程

### 0. 解析与确认

1. 解析 `--to`、选定模式、`--apply`/`--push`。  
2. `git fetch origin`（至少 fetch `--from` 与 `--to` 对应远端）。  
3. 若 `--to` 缺失、或选定模式歧义（例如只说「合并一下」没给源）→ **停下来问用户**，给出 2～3 个填参模板让其选。  
4. 解析出有序 `COMMITS=(sha1 sha2 ...)` 后，先打印预览表，**未带 `--apply` 则到此结束**。

### 1. Dry-run 预览（默认）

对每个 commit 展示：

```bash
git log -1 --format='%h %s%n%b' "$SHA"
git show --stat --oneline --no-patch "$SHA"   # 或 git show --stat -1
```

汇总表：

| # | SHA | Subject | Plan-Id | 文件数 | 是否已在目标分支 |
|---|-----|---------|---------|--------|------------------|
| 1 | … | … | … | … | `git merge-base --is-ancestor $SHA origin/$TO` → 是则标「已包含，将跳过」 |

并给出建议：

- 推荐执行命令（复制即可）：  
  `/port-commits <sha…> --to=<to> --apply --push`
- 风险：目标分支工作区是否脏、是否需要先 stash；冲突高发文件列表（与目标 tip 的 diff 重叠路径）。

**不要在 dry-run 阶段 checkout / cherry-pick / push。**

### 2. Apply（仅 `--apply`）

前置检查：

```bash
git status --porcelain   # 非空则停止，提示 stash/commit
git checkout "$TO"
git pull --ff-only origin "$TO" || true   # 有跟踪则快进；失败则报告不强行 rebase
```

按旧→新逐个：

```bash
for sha in "${COMMITS[@]}"; do
  if git merge-base --is-ancestor "$sha" HEAD; then
    echo "skip already contained: $sha"
    continue
  fi
  if ! git cherry-pick -x "$sha"; then
    # 冲突：停止循环，展示冲突文件，保留 cherry-pick 状态
    # 指导用户：解完后 git cherry-pick --continue
    # 或 git cherry-pick --abort 放弃本轮
    exit 1
  fi
done
```

- 使用 `cherry-pick -x`，在 message 中留下 `(cherry picked from commit …)`，便于审计。  
- 空提交 /「already applied」类错误：若 `--allow-empty-skip`（默认开）则 `git cherry-pick --skip` 并继续。  
- **禁止** `--no-commit` 攒一大包后乱改 message（除非用户要求 squash）。  
- **禁止** `push --force` 到目标分支。  
- 不修改 `git config`。  
- 不把无关脏文件一并提交。

### 3. Push（仅 `--apply` 且 `--push`）

```bash
git push -u origin HEAD
```

成功后回报：目标分支名、拣入的 SHA 列表、跳过的 SHA、push 远端 URL/跟踪关系。

### 4. 冲突处理协议

一旦冲突：

1. 立即停止后续 cherry-pick。  
2. 用中文列出冲突文件与双方意图（`git show :2:path` / `:3:path` 或 diff3）。  
3. **不要擅自选一边**：给出建议合并策略，等用户确认后再改文件并 `--continue`。  
4. 若用户说放弃：`git cherry-pick --abort`，回到 apply 前的 tip。

## 输出要求

- 中文；预览用表格；分支关系可用 Mermaid（禁止 ASCII 流程图）。  
- 明确写清本次是 **dry-run** 还是 **已 apply**。  
- 涉及客户分支时：commit / 报告中**不写客户真名**，用「客户分支 / Enterprise 交付分支」等中性表述（遵守仓库 plan/commit 脱敏约定）。  
- 不引入第三方品牌对标措辞进 commit message。

## 反面清单

- 不要默认 `git merge origin/main` 进客户分支。  
- 不要在用户只说「最近两次」时，不确认源 tip 就拣错分支。  
- 不要把 `pending` plan 文件误当成已实现代码去同步（应拣带 `Plan-Id` 的**实现 commit**）。  
- 不要 force push。  
- 不要在工作区脏时强行 checkout/cherry-pick。  
- 不要顺手改 cherry-pick 以外的文件（`no-scope-creep`）。

---

在聊天中触发示例：

```text
/port-commits --plan-id=2026-07-27-enterprise-portal-web-search-wiring --to=hc-0730
/port-commits 最近两次 --from=main --to=hc-0730 --apply --push
/port-commits 01ac3fc9 --to=hc-0730 --apply
```
