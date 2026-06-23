# Skill 自进化对齐 Hermes Agent：GEPA 闭环 + 五道门控

Planned-with: claude-opus-4.8
Plan-Id: 2026-06-23-skill-self-evolution-hermes-parity

> 实施模型预期：composer-2.5。本 plan 给出每个改动的**绝对路径、函数签名、JSON 形态、挂钩点与验证命令**，实施时请逐条对照，不要凭印象重构既有逻辑。

## 背景

AgenticX 已有的 skill 自进化栈：
- `agenticx/learning/observer.py` — tool call 观察记录
- `agenticx/learning/session_review_hook.py` — `on_agent_end` 后台调 `skill_manage`
- `agenticx/learning/skill_quality_gate.py` — 5 项质量检查
- `agenticx/learning/skill_usage_tracker.py` — per-skill 使用计数
- `agenticx/learning/skill_deprecation.py` — 低效技能标记
- `agenticx/learning/skill_condition_filter.py` — 按 frontmatter 过滤可见技能
- `agenticx/skills/versioning.py` — `<skill_dir>/.changelog`
- `agenticx/skills/fuzzy_patch.py` — 5 策略模糊匹配
- `agenticx/skills/guard.py` — 4 类危险模式扫描
- `agenticx/cli/agent_tools.py::_tool_skill_manage`（line ~4990） — 工具入口

对照 Hermes Agent「GEPA + 五道门控」剩余 5 个缺口：

| # | Hermes 机制 | 当前现状 | 本 plan 要补 |
|---|------------|---------|------------|
| ① | GEPA N 候选变异 + 帕累托择优 | 单候选直写 | P2 |
| ② | SKILL.md ≤15KB / description ≤500 字符**硬限制** | quality_gate 软评分 | P1 |
| ③ | 语义漂移检测 | 无 | P4 |
| ④ | `agent_writes_require_approval` 人工审批 | 直接落盘 or 全自动 | P3 |
| ⑤ | 运行中冻结 skill 修改 | 无显式锁 | P3 |

## 实施 DAG

```
P1 (config + 硬尺寸门控)
  ├──→ P2 (GEPA N 候选生成 → .proposals/)    ─┐
  └──→ P3 (审批队列 + Studio API + 冻结)       ─┼──→ P4 (benchmark + 帕累托) ──→ P5 (Desktop UI)
                                                ┘
```

- P1 是所有后续 Phase 的前置（提供配置项与硬限制函数）
- P2、P3 完全独立，可并行（不同文件、不同测试）
- P4 依赖 P2 的 `.proposals/` 隔离区与 P3 的 pending 队列结构
- P5 依赖 P4 的评分字段才能完整展示

---

## Phase 1: 配置项 + 硬尺寸门控

### 改动 1.1 — 扩展 `agenticx/learning/config.py`

在 `DEFAULTS` 字典追加 5 个键（其他逻辑不动）：

```python
DEFAULTS: dict[str, Any] = {
    # ...existing keys...
    "agent_writes_require_approval": True,   # ④ 审批门控开关
    "max_skill_bytes": 15360,                # ② SKILL.md 字节硬限制（15KB）
    "max_description_chars": 500,            # ② description 字符硬限制
    "freeze_during_session": True,           # ⑤ 活跃 session 中暂缓写操作
    "gepa_enabled": False,                   # ① GEPA N 候选模式（默认关，灰度）
    "gepa_num_candidates": 3,                # ① N 候选数
}
```

无需扩展 env override，配置只走 YAML 即可（实施时不要顺手加 env 变量，避免 scope creep）。

### 改动 1.2 — `agenticx/learning/skill_quality_gate.py` 新增硬限制函数

文件末尾追加（不要修改既有 5 项检查的逻辑）：

```python
def check_size_limits(
    skill_md_text: str,
    description: str,
    *,
    max_bytes: int = 15360,
    max_desc_chars: int = 500,
) -> dict[str, Any]:
    """Hermes-style hard size limits. Return {ok: bool, error: str, hint: str}."""
    size = len(skill_md_text.encode("utf-8"))
    if size > max_bytes:
        return {
            "ok": False,
            "error": f"SKILL.md size {size} bytes exceeds limit {max_bytes}",
            "hint": "Split long sections into references/<name>.md and reference them by relative path.",
        }
    if len(description) > max_desc_chars:
        return {
            "ok": False,
            "error": f"description length {len(description)} exceeds {max_desc_chars} chars",
            "hint": "Shorten description; move details into the SKILL.md body.",
        }
    return {"ok": True, "error": "", "hint": ""}
```

### 改动 1.3 — `agenticx/cli/agent_tools.py::_tool_skill_manage` 接入硬限制

在 `_tool_skill_manage` 的 `action == "create"` 和 `action == "patch"` 分支里，**写盘前**追加：

```python
from agenticx.learning.skill_quality_gate import check_size_limits
from agenticx.learning.config import get_learning_config as _get_lc

_cfg = _get_lc()
_check = check_size_limits(
    new_skill_md_text,                          # 即将写入的完整 SKILL.md 内容
    _extract_description_from_frontmatter(new_skill_md_text) or "",
    max_bytes=_cfg["max_skill_bytes"],
    max_desc_chars=_cfg["max_description_chars"],
)
if not _check["ok"]:
    return _skill_manage_error("size_limit", f"{_check['error']}. {_check['hint']}")
```

其中 `_extract_description_from_frontmatter` 已存在于 `agenticx/skills/frontmatter.py`，直接复用，不要新写解析器。

### 验证

```bash
# 单测
pytest tests/test_skill_size_limits.py -q

# 冒烟：构造 16KB 的 SKILL.md 调用 skill_manage create，应返回 size_limit error
python -c "from agenticx.learning.skill_quality_gate import check_size_limits; \
  r = check_size_limits('x' * 20000, 'short'); assert not r['ok']; print(r)"
```

### 任务清单
- [ ] FR-1.1 `config.py` DEFAULTS 加 6 个键
- [ ] FR-1.2 `skill_quality_gate.py` 新增 `check_size_limits`
- [ ] FR-1.3 `_tool_skill_manage` create/patch 分支接入硬限制（写盘前）
- [ ] AC-1.1 新建 `tests/test_skill_size_limits.py`，覆盖 15KB / 500 字符边界 + 正向用例
- [ ] AC-1.2 现有 `tests/test_smoke_hermes_agent_*.py` 全绿（回归）

---

## Phase 2: GEPA N 候选生成 → `.proposals/` 隔离区

### 隔离区目录结构

```
~/.agenticx/skills/.proposals/
└── <proposal_id>/                # uuid4
    ├── proposal.json             # 见下方 JSON 形态
    └── SKILL.md                  # 候选完整内容
```

`proposal.json` 形态：

```json
{
  "proposal_id": "9a1f...e3",
  "base_skill": "fix-node-pty-rebuild",
  "action": "create" | "patch",
  "author_session_id": "sess_2026...",
  "author_model": "gpt-4o-mini",
  "created_at": "2026-06-23T07:30:00Z",
  "candidate_index": 1,
  "total_candidates": 3,
  "diff_summary": "Added pitfalls section; tightened description.",
  "scores": null,                  // P4 填
  "status": "pending"              // pending | approved | rejected
}
```

### 改动 2.1 — 新建 `agenticx/learning/gepa_proposer.py`

```python
#!/usr/bin/env python3
"""GEPA-style N-candidate proposer for skill self-evolution.

Author: Damon Li
"""

from __future__ import annotations
import json, uuid, logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("agenticx.learning.gepa")

PROPOSALS_ROOT = Path.home() / ".agenticx" / "skills" / ".proposals"


def proposals_root() -> Path:
    PROPOSALS_ROOT.mkdir(parents=True, exist_ok=True)
    return PROPOSALS_ROOT


def generate_candidates(
    *,
    base_skill_name: str,
    action: str,                       # "create" | "patch"
    session_id: str,
    review_model: str,
    base_skill_md: str | None,         # patch 时为旧内容，create 时 None
    review_context: str,               # session_review_hook 收集的会话上下文
    n: int = 3,
) -> list[Path]:
    """Generate N candidate SKILL.md variants. Return list of proposal dirs.

    Mutation strategy: ask the review LLM to produce N variants in a single
    call, each varying ONE of {description, procedure, pitfalls}. Falls back
    to single-candidate behavior if the LLM returns <n variants.
    """
    # 1) build prompt that asks LLM to emit JSON: {"candidates":[{"skill_md":"...","diff_summary":"..."}]}
    # 2) call LLM via existing agenticx.llms helper (reuse the same path session_review_hook uses)
    # 3) for each candidate, write proposal dir + proposal.json + SKILL.md
    # 4) return paths
    ...
```

**重点**：
- LLM 调用必须复用 `session_review_hook.py` 里已有的调用方式（同 provider/model 解析路径），不要新写一套 client
- 失败回退到 N=1，记 warning，不抛异常
- N 候选写入前都跑 P1 的 `check_size_limits`，超限的候选直接丢弃

### 改动 2.2 — `session_review_hook.py` 接入 GEPA（feature flag）

在 `session_review_hook.py` 的入口函数（搜 `_run_review` 或类似）加分支：

```python
from agenticx.learning.config import get_learning_config

_cfg = get_learning_config()
if _cfg.get("gepa_enabled"):
    from agenticx.learning.gepa_proposer import generate_candidates
    paths = generate_candidates(
        base_skill_name=...,
        action=...,
        session_id=...,
        review_model=_cfg["review_model"],
        base_skill_md=...,
        review_context=...,
        n=int(_cfg.get("gepa_num_candidates", 3)),
    )
    # 不再直接调用 skill_manage 写主目录，等待 P3 审批
    return
# else: 现有单候选直写逻辑保持不动
```

### 任务清单
- [ ] FR-2.1 新建 `agenticx/learning/gepa_proposer.py`（`proposals_root`、`generate_candidates`）
- [ ] FR-2.2 候选写入 `.proposals/<id>/` 且不污染 `~/.agenticx/skills/` 主目录（`registry.py` 扫描需跳过 `.proposals/`，搜 `list_skills`/`scan_skills` 加 `if name.startswith("."): continue`）
- [ ] FR-2.3 `session_review_hook.py` 接入 feature flag，关闭时旧行为 0 改动
- [ ] AC-2.1 `tests/test_gepa_proposer.py`：mock LLM 返回 3 候选，验证 3 个 `.proposals/<id>/` 目录、proposal.json 字段齐全
- [ ] AC-2.2 `gepa_enabled=False` 时跑现有 session review 冒烟，行为与改动前一致

---

## Phase 3: 审批队列 + Studio API + 运行中冻结

### 改动 3.1 — 新建 `agenticx/skills/pending_queue.py`

```python
#!/usr/bin/env python3
"""Pending skill proposal queue: list / approve / reject.

Approve = merge .proposals/<id>/SKILL.md into ~/.agenticx/skills/<name>/
          + append .changelog (action="approved", author=<user>)
          + delete .proposals/<id>/
Reject  = delete .proposals/<id>/ only.

Author: Damon Li
"""

from pathlib import Path

def list_pending() -> list[dict]:
    """Return list of proposal.json contents (sorted by created_at desc)."""
    ...

def approve(proposal_id: str, *, approver: str = "user") -> dict:
    """Merge candidate into main skills dir. Return {ok, skill_name, error}."""
    ...

def reject(proposal_id: str, *, reason: str = "") -> dict:
    ...

def cleanup_stale(max_age_days: int = 30) -> int:
    """Delete proposals older than N days. Return count."""
    ...
```

合并到主目录时**必须**：
- 复用 `agenticx/skills/versioning.py::append_changelog(action="approved", author=approver)`
- 复用 P1 的 `check_size_limits`（防御性二次校验）
- 不要绕过 `guard.py` 扫描

### 改动 3.2 — 接入 `skill_manage` 写操作转 pending

在 `_tool_skill_manage` 的 create/patch 分支里，**在硬限制校验之后**判断：

```python
if _cfg["agent_writes_require_approval"]:
    from agenticx.learning.gepa_proposer import proposals_root
    import uuid, json
    pid = uuid.uuid4().hex
    pdir = proposals_root() / pid
    pdir.mkdir(parents=True)
    (pdir / "SKILL.md").write_text(new_skill_md_text, encoding="utf-8")
    (pdir / "proposal.json").write_text(json.dumps({
        "proposal_id": pid,
        "base_skill": name,
        "action": action,
        "author_session_id": session.session_id if session else "",
        "author_model": "",
        "created_at": _now_iso(),
        "candidate_index": 1,
        "total_candidates": 1,
        "diff_summary": "",
        "scores": None,
        "status": "pending",
    }), encoding="utf-8")
    return _skill_manage_success_payload(
        action=f"{action}_pending",
        name=name,
        path=str(pdir),
        message=f"Proposal queued for approval: {pid}",
    )
# else: 现有直写逻辑
```

### 改动 3.3 — 运行中冻结

`agenticx/runtime/session_manager.py`（或同等位置，搜 `class SessionManager`）维护一个**进程级**计数：

```python
_active_session_count = 0

def inc_active(): global _active_session_count; _active_session_count += 1
def dec_active(): global _active_session_count; _active_session_count = max(0, _active_session_count - 1)
def is_frozen() -> bool: return _active_session_count > 0
```

在 session 创建/销毁路径分别调 `inc_active`/`dec_active`。`_tool_skill_manage` 在写操作前判断：若 `is_frozen() and cfg["freeze_during_session"]` 则**也走 pending 队列**（语义上等价：冻结时所有写都先排队，由 session 结束后 hook 或人工审批触发合并）。

> 注意：`session_review_hook` 本就在 `on_agent_end` 触发（session 已结束），不受冻结影响——但 hook 内若调用 GEPA 后通过 `agent_writes_require_approval` 写 pending，是合理的最终态。

### 改动 3.4 — Studio REST 端点

`agenticx/studio/server.py` 加：

```python
@app.get("/api/skills/proposals")
async def list_skill_proposals():
    from agenticx.skills.pending_queue import list_pending
    return {"proposals": list_pending()}

@app.post("/api/skills/proposals/{pid}/approve")
async def approve_skill_proposal(pid: str):
    from agenticx.skills.pending_queue import approve
    return approve(pid, approver="desktop-user")

@app.post("/api/skills/proposals/{pid}/reject")
async def reject_skill_proposal(pid: str, payload: dict | None = None):
    from agenticx.skills.pending_queue import reject
    return reject(pid, reason=(payload or {}).get("reason", ""))
```

### 任务清单
- [ ] FR-3.1 新建 `agenticx/skills/pending_queue.py`（list/approve/reject/cleanup_stale）
- [ ] FR-3.2 `_tool_skill_manage` 接入「审批开关 → 转 pending」
- [ ] FR-3.3 `session_manager.py`（或等价位置）加 `inc_active/dec_active/is_frozen`，冻结时写操作转 pending
- [ ] FR-3.4 Studio 3 个 REST 端点 + OpenAPI/路由注册
- [ ] AC-3.1 `tests/test_pending_queue.py`：create→pending→approve 后主目录正确、`.changelog` 含 `approved` 行；reject 后目录被清
- [ ] AC-3.2 `tests/test_skill_freeze.py`：mock 活跃 session，验证 skill_manage 写转 pending
- [ ] AC-3.3 `curl http://127.0.0.1:<port>/api/skills/proposals` 返回 JSON 列表

---

## Phase 4: 语义漂移 benchmark + 帕累托择优

### benchmark 文件位置

每个 skill 可选携带：`~/.agenticx/skills/<name>/tests/benchmark.yaml`

```yaml
# benchmark.yaml 形态
cases:
  - input: "用户问题或场景描述"
    expect_keywords: ["关键词1", "关键词2"]     # 命中任一即视为相关
    expect_regex: "^Step \\d+:"                  # 可选，正则匹配
```

缺失 benchmark 时：跳过该 skill 的漂移检测，记 warning，候选直接进入 pending（不被淘汰）。

### 改动 4.1 — 新建 `agenticx/learning/drift_detector.py`

```python
def score_candidate(
    *,
    base_skill_md: str | None,
    candidate_skill_md: str,
    benchmark_path: Path,
    review_model: str,
) -> dict[str, float]:
    """Return {"accuracy": float, "brevity": float, "robustness": float}.

    accuracy: 用 candidate skill md 作为 system prompt，跑 benchmark cases，
              统计 expect_keywords / expect_regex 命中率（确定性，不靠 LLM judge）
    brevity:  1 - len(candidate) / max(len(base), len(candidate))，越短越高
    robustness: 候选对 cases 中 input 末尾追加随机噪音字符后命中率/原命中率
    """
    ...

def pareto_front(scored: list[tuple[Path, dict]]) -> list[Path]:
    """Return non-dominated candidate paths (max all 3 dims)."""
    ...
```

**关键约束**：3 维评分**全部用确定性算法**（keyword/regex 命中率 + 字符长度比），**不引入 LLM-as-judge**。理由：(a) composer-2.5 实施时确定性逻辑更易写对；(b) LLM judge 引入随机性与额外成本，与「灰度上线」目标相悖。

### 改动 4.2 — 接入 P2 候选评分

`gepa_proposer.generate_candidates` 返回前追加：

```python
from agenticx.learning.drift_detector import score_candidate, pareto_front
scored = []
for p in candidate_paths:
    bm = _find_benchmark_for(base_skill_name)
    if bm is None:
        scored.append((p, {"accuracy": 1.0, "brevity": 0.5, "robustness": 1.0}))
        continue
    sc = score_candidate(
        base_skill_md=base_skill_md,
        candidate_skill_md=(p / "SKILL.md").read_text(encoding="utf-8"),
        benchmark_path=bm,
        review_model=review_model,
    )
    scored.append((p, sc))
front = set(pareto_front(scored))
# 把 scores 回写每个 proposal.json；不在前沿的候选目录被删除
```

### 任务清单
- [ ] FR-4.1 定义 `benchmark.yaml` schema（在 `docs/guides/skill-benchmark.md` 写一页说明，便于用户编写）
- [ ] FR-4.2 新建 `agenticx/learning/drift_detector.py`（score_candidate + pareto_front）
- [ ] FR-4.3 `gepa_proposer.generate_candidates` 接入评分 + 帕累托剪枝
- [ ] FR-4.4 Studio `/api/skills/proposals` 返回的每条 proposal 带 `scores` 字段
- [ ] AC-4.1 `tests/test_drift_detector.py`：构造 3 候选 + 含 2 个 case 的 benchmark，验证帕累托前沿正确
- [ ] AC-4.2 无 benchmark.yaml 时候选不被淘汰

---

## Phase 5: Desktop Review UI

### 改动 5.1 — 新组件 `desktop/src/components/settings/skills/PendingProposalsList.tsx`

```tsx
// 数据形态
interface ProposalScore { accuracy: number; brevity: number; robustness: number; }
interface Proposal {
  proposal_id: string;
  base_skill: string;
  action: "create" | "patch";
  created_at: string;
  diff_summary: string;
  scores: ProposalScore | null;
  status: "pending";
}

// 渲染：
// - 每条 proposal 一张 Card：title=base_skill, badge=action, 右上时间
// - diff_summary 单行
// - 3 维评分用 <ScoreBar value={s.accuracy} /> 横向小柱（已有 UI 原语就复用，没有就用简单 div 实现）
// - 底部两按钮：Approve（主色） / Reject（次色）
// - approve/reject 后调 /api/skills/proposals/{id}/approve|reject，成功局部刷新
```

### 改动 5.2 — Skills Tab 集成

在 `desktop/src/components/settings/SkillsTab.tsx`（或等价文件，搜 `Skills` Tab 组件）：

- Tab 标题文案：若 `pending.length > 0` 则展示 `技能 (3)` 风格 badge（数字为待审数）
- Tab 顶部加可折叠分区：「待审 (N)」，默认展开（N=0 时整段隐藏）
- 内容渲染 `<PendingProposalsList />`

### 改动 5.3 — IPC / fetch

不需要新 Electron IPC——`agx serve` 已提供 REST，直接走现有 `fetch(\`${baseUrl}/api/skills/proposals\`)`。

### 任务清单
- [ ] FR-5.1 新建 `PendingProposalsList.tsx`
- [ ] FR-5.2 Skills Tab 集成「待审」分区与 badge
- [ ] FR-5.3 三主题（dark/dim/light）视觉验证（手动）
- [ ] AC-5.1 手动：触发一次 GEPA → 设置页 Skills Tab 看到 N 条 → 点 Approve 后主目录出现新 skill 且 `.changelog` 有 `approved` 条目
- [ ] AC-5.2 空态文案：「暂无待审 skill 变更」，不展示运维路径或英文

---

## 非目标（严格遵守，避免 scope creep）

- ❌ 不引入 DSPy、Optuna 等新依赖
- ❌ 不修改 `agenticx/skills/bundle.py` / `registry_hub.py`
- ❌ 不改动现有 `quality_gate.py` 5 项检查逻辑（仅追加新函数）
- ❌ 不动 git 流程、不动 `/commit` 命令
- ❌ 不为 P4 引入 LLM-as-judge
- ❌ 不在 P1 加新的环境变量（只走 YAML config）

## 配置示例（写入 README/文档时复用）

```yaml
# ~/.agenticx/config.yaml
learning:
  enabled: true
  review_enabled: true
  review_model: "gpt-4o-mini"
  agent_writes_require_approval: true   # ④
  max_skill_bytes: 15360                # ②
  max_description_chars: 500            # ②
  freeze_during_session: true           # ⑤
  gepa_enabled: false                   # ① 默认关，灰度
  gepa_num_candidates: 3
```

## 验证矩阵

| Phase | 命令 |
|------|------|
| P1 | `pytest tests/test_skill_size_limits.py -q` |
| P2 | `pytest tests/test_gepa_proposer.py -q` |
| P3 | `pytest tests/test_pending_queue.py tests/test_skill_freeze.py -q` + `curl /api/skills/proposals` |
| P4 | `pytest tests/test_drift_detector.py -q` |
| P5 | 手动桌面验收（见 AC-5.1） |
| 全量回归 | `pytest tests/test_smoke_hermes_agent_*.py -q` 必须全绿 |

## 风险

- R1 `.proposals/` 膨胀 → P3 `cleanup_stale(30)` 每次 `list_pending` 时调一次
- R2 freeze 与 `on_agent_end` 时序：on_agent_end 触发时该 session 已不在活跃计数内 → 不会误冻结
- R3 GEPA 默认关闭，灰度后再考虑加 desktop 设置开关（本 plan 不做）
