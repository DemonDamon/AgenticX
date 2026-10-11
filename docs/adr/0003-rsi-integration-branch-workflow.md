# ADR 0003: RSI 长生命周期集成分支研发规则

## 状态

Accepted — 2026-10-11

---

## 背景

RSI 数据飞轮是一条持续演进的研发线（`plans/rsi/` SP1-SP33），不适合每个 SP 开短分支再逐个合并。
2026-10-11 合并 PR #54（`feat/rsi-data-flywheel`）时暴露了长分支失管的代价：

- 分支累积 **96 个提交、181 文件、+84k 行**，单 PR 无法有效 review
- 落后 main **260 个提交**，PR 描述（写的是 SP1-SP3 / 18 提交）与实际范围（SP29）严重脱节
- **11.1MB 原始实验数据混入库**，其中轨迹捕获的终端输出含真实 API key，
  触发安全扫描拦截，被迫重写分支历史（filter-branch）才完成合并

决策：保留 `feat/rsi-data-flywheel` 作为长生命周期集成分支滚动开发，但以本 ADR 的规则约束其纪律。

---

## 决策

### 1. 分支模型

- `feat/rsi-data-flywheel` 为 RSI 研发的**常驻集成分支**，SP30+ 均在此分支开发
- main 上的其他研发线不受影响；RSI 与其他线的交叉改动仍走各自的分支
- 同一分支在上一 PR 合并后可直接再开新 PR，diff 只计合并点之后的新提交

### 2. 同步纪律（防漂移）

- **每周至少一次**将 main 合入分支；任何一个 SP 开始前必须先同步
- 同步后跑 RSI 相关测试套件（`tests/trainer tests/trajectory tests/rl`）确认无回归
- 禁止"攒着不同步"——本次 260 提交漂移是所有后续问题的放大器

### 3. PR 节奏（防大爆炸）

- 按 **SP 或 2-3 个 SP 一组** 开 PR 合并；单 PR 原则上不超过 **30 个提交**
- PR 描述必须与实际范围一致：滚动开发中每合入一轮，下一轮 PR 描述从头写，
  不允许沿用旧描述
- PR 合并门槛：
  - 安全扫描（gitleaks / 客户关键词 / 依赖审计）**必须全绿**
  - 测试**零新增回归**：与 main 基线 worktree 对照失败清单，确认所有失败为存量
  - main 存量红灯（CI 既有失败）不阻塞合并，但需在 PR 描述中标注为存量

### 4. 产出物入库纪律（防数据泄漏）

- **训练/实验产出物一律不入库**，包括：原始轨迹、决策标注、数据集、checkpoint、日志
- 已有 ignore 规则：`datasets/`、`results/**/*.jsonl`（汇总报告 `.md`/`.json` 例外）
- **新增任何输出目录必须同步补 `.gitignore` 规则**——这是提交前 checklist 的一部分，
  不是事后补救
- 入库的汇总报告发布前人工过目，确认无捕获的终端输出/环境变量残留

### 5. 安全红线

- 真实凭证（API key、token、密码）**绝不入库**，包括以轨迹数据、配置文件、
  测试夹具任何形式的间接夹带
- 轨迹采集链路捕获的终端输出天然可能含环境变量——这是第 4 条存在的根本原因
- 一旦泄漏：立即轮换密钥（唯一根治手段）+ 从分支历史清除（filter-branch 仅重写
  分支独有提交，保持与 main 的共同基底不变）+ force-push
- 经验：`git filter-repo --refs <branch>` 会连同与 main 共享的基底一起改写导致历史
  脱节，应使用 `git filter-branch --index-filter ... -- <merge-base>..<branch>`

---

## 操作流程（每轮开发循环）

```
1. git merge main                # 同步（SP 开始前必须）
2. python3 -m pytest tests/trainer tests/trajectory tests/rl -q   # 回归确认
3. ...开发（新输出目录 → 同步补 .gitignore）...
4. git push origin feat/rsi-data-flywheel
5. gh pr create（描述覆盖本轮实际范围）
6. CI 绿 + 零新增回归 → merge
7. 回到 1
```

---

## 后果

- 正面：RSI 研发有稳定落点，review 粒度可控，安全与产出物规则有据可依
- 负面：分支常驻要求持续的同步纪律；若再次长期不同步，本 ADR 的所有规则都会失效
- 观察项：main 存量 CI 红灯（DB contract 迁移数量断言、Vercel 构建）另行修复，
  修复后第 3 条的"存量标注"要求自动收敛
