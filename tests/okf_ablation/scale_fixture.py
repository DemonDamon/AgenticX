"""规模化消融 fixture 生成器：按规模生成多领域知识库与查询标注。

目标：观察结论（陷阱过滤、token 经济、召回质量）在规模逐级放大时是否恒定。

设计：
- 8 个领域轮转分配概念（电商/金融/供应链/内容/人力/医疗/法务/制造），
  每领域 4 种概念类型（表/指标/流程/参考）；
- 状态按 i%10 确定性分配：0-5 stable（0 号加 verified）、6 draft、7-8
  deprecated、9 stale（stale_after 设为已过期），各规模构成比例一致；
- 查询密度与原 fixture 相同（每 15 概念 12 条查询），target 从 stable 概念
  采样，同域陷阱自动标注（每查询最多 3 个）；
- 全部用 Random(seed) 确定性生成；概念序列前缀跨规模一致（scale=60 的前
  15 个概念与 scale=15 相同），便于跨规模对比。
"""

from __future__ import annotations

import random
from pathlib import Path
from typing import Dict, List, Tuple

DOMAINS: Dict[str, List[str]] = {
    "ecom": ["订单", "客户", "支付", "物流", "退款", "库存", "购物车", "优惠券", "评价", "发票"],
    "fin": ["账户", "交易", "风控", "对账", "清算", "授信", "理财", "保费", "证券", "结算"],
    "supply": ["采购", "供应商", "物料", "仓配", "计划", "交货", "质检", "补货", "调度", "履约"],
    "content": ["文章", "视频", "评论", "标签", "话题", "订阅", "推荐", "热度", "审核", "专栏"],
    "hr": ["考勤", "薪酬", "绩效", "招聘", "培训", "调岗", "休假", "工时", "编制", "离职"],
    "med": ["挂号", "处方", "病历", "药品", "检查", "检验", "护理", "随访", "床位", "挂号费"],
    "legal": ["合同", "条款", "诉讼", "合规", "商标", "专利", "仲裁", "公证", "备案", "侵权"],
    "mfg": ["工单", "设备", "产线", "工序", "质检", "维修", "备件", "点检", "工艺", "能耗"],
}

KINDS = [
    ("table", "BigQuery Table", "表"),
    ("metric", "Metric", "指标"),
    ("process", "Process", "流程"),
    ("reference", "Reference", "参考"),
]

STALE_DATES = ["2026-09-30T00:00:00Z", "2026-10-31T00:00:00Z", "2026-08-31T00:00:00Z"]


def _concept(i: int, seed: int) -> Dict:
    """生成第 i 个概念的完整描述（确定性，前缀跨规模一致）。"""
    rng = random.Random(seed * 100003 + i)
    domain_key = list(DOMAINS)[i % len(DOMAINS)]
    domain = DOMAINS[domain_key]
    kind_slug, kind_type, kind_cn = KINDS[(i // len(DOMAINS)) % len(KINDS)]
    entity = domain[i % len(domain)]
    pool = [w for w in domain if w != entity]
    keywords = rng.sample(pool, min(4, len(pool)))

    mod = i % 10
    frontmatter = {"type": kind_type, "title": f"{entity}{kind_cn}{i:03d}", "tags": [domain_key]}
    if mod == 0:
        frontmatter["verified"] = [{"by": "human:domain-lead", "at": "2026-11-20T00:00:00Z"}]
    if mod == 6:
        frontmatter["status"] = "draft"
    elif mod in (7, 8):
        frontmatter["status"] = "deprecated"
    elif mod == 9:
        frontmatter["status"] = "stable"
        frontmatter["stale_after"] = STALE_DATES[i % len(STALE_DATES)]
    else:
        frontmatter["status"] = "stable"
        frontmatter["stale_after"] = "2027-06-30T00:00:00Z"

    kw_text = "、".join(keywords)
    body = (
        f"# {entity}{kind_cn}{i:03d}\n\n"
        f"{entity}{kind_cn}记录{entity}相关数据，关联字段包括{kw_text}；"
        f"口径以{keywords[0]}为基准，{keywords[1]}按日更新。"
    )
    rel_path = f"{domain_key}/{kind_slug}s/{entity}_{i:04d}"
    return {"rel_path": rel_path, "frontmatter": frontmatter, "body": body,
            "domain": domain_key, "entity": entity, "keywords": keywords,
            "mod": mod}


def generate_bundle(scale: int, root: Path, seed: int = 42) -> Tuple[Path, List[Dict]]:
    """生成 scale 个概念的 Bundle，返回 (Bundle 根, 概念描述列表)。"""
    root.mkdir(parents=True, exist_ok=True)
    concepts = [_concept(i, seed) for i in range(scale)]
    for c in concepts:
        file_path = root / f"{c['rel_path']}.md"
        file_path.parent.mkdir(parents=True, exist_ok=True)
        fm_lines = ["---"]
        for key, value in c["frontmatter"].items():
            if isinstance(value, list):
                fm_lines.append(f"{key}:")
                for item in value:
                    fm_lines.append(f"  - {item}")
            else:
                fm_lines.append(f"{key}: {value}")
        fm_lines.append("---")
        file_path.write_text("\n".join(fm_lines) + "\n\n" + c["body"], encoding="utf-8")
    return root, concepts


def generate_queries(concepts: List[Dict], seed: int = 42) -> List[Tuple[str, List[str], List[str]]]:
    """从 stable 概念采样生成查询与标注（密度：每 15 概念 12 条）。"""
    rng = random.Random(seed * 7 + len(concepts))
    n_queries = max(4, len(concepts) * 12 // 15)
    stable = [c for c in concepts if c["mod"] < 6]
    if not stable:
        return []
    queries = []
    for _ in range(n_queries):
        target = stable[rng.randrange(len(stable))]
        # 查询词：实体 + target 关键词 2 个（保证 target 高分命中）
        q_words = [target["entity"]] + target["keywords"][:2]
        rng.shuffle(q_words)
        query = " ".join(q_words)
        # 同域陷阱（deprecated/stale），最多 3 个
        traps = [
            c for c in concepts
            if c["domain"] == target["domain"] and c["mod"] in (6, 7, 8, 9) and c is not target
        ][:3]
        trap_ids = [t["rel_path"] for t in traps if t["mod"] in (7, 8, 9)]
        relevant = [target["rel_path"]]
        queries.append((query, relevant, trap_ids))
    return queries


def build_scale_fixture(scale: int, root: Path, seed: int = 42):
    """生成 Bundle + 查询集，返回 (bundle_root, queries, concepts)。"""
    bundle_root, concepts = generate_bundle(scale, root, seed)
    queries = generate_queries(concepts, seed)
    return bundle_root, queries, concepts


def domain_distribution(concepts: List[Dict]) -> Dict[str, int]:
    """统计各领域概念数（规模化报告的分布记录）。"""
    dist: Dict[str, int] = {}
    for c in concepts:
        dist[c["domain"]] = dist.get(c["domain"], 0) + 1
    return dict(sorted(dist.items(), key=lambda kv: -kv[1]))
