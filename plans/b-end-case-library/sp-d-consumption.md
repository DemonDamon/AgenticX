# SP-D: 消费路径（检索 + 初始化注入）

> **批次**: 2（依赖 SP-C 的 CaseEntry/CaseStore）
> **纪律**: 检索复用 `brain/search.py` 已有 L0 能力或直接用 index.json（不新建向量索引服务）。注入是文件复制 + frontmatter 引用，不做运行时 hook。

## 目标

新项目初始化时：按意图检索 case（L0 粗筛 + scope 过滤）→ 用户确认 → L2 装配（wiki 页面/skills/plan 模板注入新项目）。

## 改动点

### 1. `agenticx/cases/search.py`（新增）

```python
@dataclass
class CaseHit:
    entry: CaseEntry
    score: float
    matched_on: list[str]      # ["summary", "problem", "domain"]

def search_cases(
    query: str,
    *, store: CaseStore,
    scope_filter: dict[str, str] | None = None,   # 如 {"domain": "automotive"}，命中才保留
    top_k: int = 5,
) -> list[CaseHit]:
    """V1 实现走编译期索引（index.json）：关键词/子串匹配 summary+problem+solution 打分，
    scope_filter 硬过滤（scope 字段值必须相等；case 无该 scope 键则不过滤掉，保守放行）。
    不引入向量检索——量小（<100 case）时关键词够用，等量级上来再接 brain/search.py 的 embedding。"""
```

### 2. `agenticx/cases/init_inject.py`（新增）

```python
@dataclass
class InjectionResult:
    plan_path: Path            # 生成的初始 plan.mdc
    wiki_pages: list[Path]     # 复制进新项目的 wiki 页面
    skills: list[Path]         # 复制的 skill 目录
    report: str                # 人可读的注入报告

def init_project_from_case(
    case: CaseEntry,
    *,
    target_dir: Path,           # 新项目根目录（须为空或不存在）
    store: CaseStore,
    intent: str = "",
) -> InjectionResult:
    """装配逻辑：
    1. plan.mdc：default_plan() 基础上填 intent、scope（来自 case.scope）、case_refs=[case.case_id]
       （复用 plan_mdc.py 的 default_plan/write_plan——SP-A 的字段直接可用）
    2. wiki 页面：case.artifacts 中 wiki/ 前缀的条目复制到 target_dir/wiki/
    3. skills：case.artifacts 中 skills/ 前缀的条目复制到 target_dir/skills/
    4. 缺失的 artifact 路径不失败，记入 report（容忍脏数据）"""
```

### 3. CLI：`agenticx/cli/main.py` 追加

```
agenticx case search <query> [--domain xxx] [--top-k 5]
agenticx case init --case <case_id> --target <dir> [--intent "..."]
```

## 验收（agent 自验，master 复验）

```bash
python -m pytest tests/ -k "case" -x -q
```

新增 `tests/test_case_consume.py`：
- 构造 2 个 case（不同 domain）→ search 命中正确 + scope_filter 过滤生效
- `init_project_from_case`：空目录注入后 plan.mdc 含 case_refs/intent/scope；wiki 页面/skills 复制到位；artifact 缺失时 report 记录且不抛异常
- CLI 两条命令冒烟（tmp 目录）
- search 无结果返回空列表（不报错）

## 不做

- 不做向量/embedding 检索（索引关键词够用，量级说明见上）
- 不做检索路由（按任务类型分策略——蔚来 G5 是优化项）
- 不做桌面端 UI（SP-E）
