#!/usr/bin/env python3
"""TeamBench 打分器 v2（替代 teambench_runner.ArtifactScorer）。

相对 v0.1 的三处修正：
  L1  字符袋检验 → Markdown 标题结构解析 + 同义词表（长度不变）
  L2  "文中离目标最近的数" → 强制结构化答案块 + 集合级 Precision/Recall/F1
  L3  关闭时注入常数 0.6 → 关闭时重归一化 L1/L2 权重（消除 CTR 加性偏置）

设计原则：L1+L2 权重 >= 80%，LLM-judge <= 20%，与指标定义 v0.1 一致。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

W_L1, W_L2, W_L3 = 0.50, 0.30, 0.20

_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+(.+?)\s*$", re.M)
_BOLD_HEAD_RE = re.compile(r"^\s{0,3}\*\*(.+?)\*\*\s*$", re.M)
_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", re.S)


def _norm(s: str) -> str:
    return re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]+", "", s or "").lower()


@dataclass
class ScoreDetail:
    L1: float = 0.0
    L2: float = 0.0
    L3: float = 0.6
    L1_items: Dict[str, float] = field(default_factory=dict)
    L2_items: Dict[str, float] = field(default_factory=dict)
    Q: float = 0.0
    TMS: bool = False
    notes: List[str] = field(default_factory=list)


# ── L1：结构层（长度不变，内容感知） ────────────────────────────────
def extract_headings(text: str) -> List[str]:
    """抽取产出中的所有标题（markdown # 标题 + 独立成行的粗体标题）。"""
    hs = [m.group(1).strip() for m in _HEADING_RE.finditer(text or "")]
    hs += [m.group(1).strip() for m in _BOLD_HEAD_RE.finditer(text or "")]
    return hs


# 装配协议（blackboard）为空章节渲染的占位符；不得记为有效内容
_PLACEHOLDER_RE = re.compile(r"^\s*[（(]?\s*(本节无内容|无内容|暂无|略|N/?A)\s*[)）]?\s*[。.]?\s*$")


def _split_sections(text: str, boundary_norms: Set[str] = None) -> List[Tuple[str, str]]:
    """按标题（# 或独立成行粗体）把文本切成 (heading, body) 段。

    章节范围规则（标准 markdown 语义）：
      - # 标题的边界 = 下一个同级或更高级的 # 标题；
      - 任何命中 boundary_norms（规范章节名/同义词，规范化后互为子串另判）的
        标题**总是**边界——即使层级更深、即使是粗体伪标题；
      - 粗体伪标题视为最深层，不切断父章节，除非它命中 boundary_norms。
    """
    if not text:
        return []

    def _is_boundary(hnorm: str) -> bool:
        if not boundary_norms or not hnorm:
            return False
        return any(hnorm == b or b in hnorm or hnorm in b for b in boundary_norms if b)

    marks = []
    for m in _HEADING_RE.finditer(text):
        lead = m.group(0).lstrip()
        hashes = len(lead) - len(lead.lstrip("#"))
        marks.append([m.start(), m.end(), m.group(1).strip(), hashes, False])
    for m in _BOLD_HEAD_RE.finditer(text):
        marks.append([m.start(), m.end(), m.group(1).strip(), 99, True])
    marks.sort(key=lambda x: x[0])
    if not marks:
        return [("", text)]

    norms = [_norm(h) for (_s, _e, h, _l, _b) in marks]
    res: List[Tuple[str, str]] = []
    if marks[0][0] > 0:
        head = text[: marks[0][0]].strip()
        if head:
            res.append(("", head))
    for i, (_s, e, h, lv, _b) in enumerate(marks):
        end = len(text)
        for j in range(i + 1, len(marks)):
            s2, _e2, _h2, lv2, bold2 = marks[j]
            if _is_boundary(norms[j]) or (not bold2 and lv2 <= lv):
                end = s2
                break
        res.append((h, text[e:end]))
    return res


def _body_has_content(body: str) -> bool:
    """章节正文是否有实质内容：去掉占位符后规范化长度 >= 8。"""
    lines = [ln for ln in (body or "").splitlines()
             if ln.strip() and not _PLACEHOLDER_RE.match(ln.strip())]
    joined = "".join(lines)
    return len(_norm(joined)) >= 8


def score_l1(output: str, task: Dict) -> Tuple[float, Dict[str, float]]:
    """章节覆盖率：规范章节作为**标题**出现**且其下有实质内容**。长度不变。

    v0.2.1 修正：v0.2 只查标题存在性，被装配协议（blackboard 机械渲染
    全部规范标题、空章节填占位符）白嫖满分。现在标题命中后还要求正文
    非占位、规范化长度 >= 8，否则该章节记 0。

    匹配规则（按优先级）：
      1. 规范化后完全相等
      2. 规范化后互为子串
      3. 命中 verification.section_synonyms[section] 中的任一同义词
    """
    V = task.get("verification", {}) or {}
    sections: List[str] = V.get("required_sections") or []
    synonyms: Dict[str, List[str]] = V.get("section_synonyms") or {}
    if not sections:
        return 1.0, {}

    boundary = {_norm(x) for x in sections}
    for syns in synonyms.values():
        boundary.update(_norm(x) for x in syns)
    secs = _split_sections(output or "", boundary_norms=boundary)
    items: Dict[str, float] = {}
    hit = 0
    for sec in sections:
        s = _norm(sec)
        cand = [s] + [_norm(x) for x in synonyms.get(sec, [])]
        best = 0.0
        for heading, body in secs:
            h = _norm(heading)
            matched = any(
                (h == c) or (c and c in h) or (h and h in c)
                for c in cand if c
            ) if h else False
            if matched:
                if _body_has_content(body):
                    best = 1.0
                    break          # 命中且有内容，无需再看其他同名章节
                # 命中但无内容：保留 0，继续找其他同名章节
        items[f"sec::{sec}"] = best
        hit += 1 if best else 0
    return hit / len(sections), items


# ── L2：事实层（集合级 P/R/F1） ─────────────────────────────────────
def extract_answer_block(output: str) -> Optional[Any]:
    """抽取产出中的结构化答案块。

    约定：任务 prompt 要求产出末尾附一个 ```json ...``` 块，内含可机器校验的字段。
    找不到返回 None（此时 L2 记 0 并在 notes 中标注，不做启发式猜测）。
    """
    blocks = _JSON_BLOCK_RE.findall(output or "")
    for b in reversed(blocks):          # 取最后一个，通常是总结块
        try:
            return json.loads(b)
        except json.JSONDecodeError:
            continue
    return None


def _f1(pred: Set[str], gold: Set[str]) -> Tuple[float, float, float]:
    if not gold:
        return 1.0, 1.0, 1.0
    if not pred:
        return 0.0, 0.0, 0.0
    tp = len(pred & gold)
    p = tp / len(pred)
    r = tp / len(gold)
    f = (2 * p * r / (p + r)) if (p + r) else 0.0
    return p, r, f


def score_l2(output: str, task: Dict) -> Tuple[float, Dict[str, float], List[str]]:
    """数值/集合层。全部基于结构化答案块，杜绝"找最近的数"。

    支持的 ground-truth 字段（在 task.verification 下）：
      expected_sets   : {字段名: [元素,...]}   → 集合 F1
      expected_values : {字段名: 数值}          → 相对误差 <= tol 记 1
      expected_counts : {字段名: 最小条目数}    → 结构化块中该字段长度 >= 阈值
    """
    V = task.get("verification", {}) or {}
    notes: List[str] = []
    items: Dict[str, float] = {}
    scores: List[float] = []

    exp_sets = V.get("expected_sets") or {}
    exp_vals = V.get("expected_values") or {}
    exp_cnts = V.get("expected_counts") or {}
    schema = V.get("answer_block_schema") or {}
    # 迁移后任务均声明 answer_block_schema；三个 expected_* 全空 == L2 明确放弃校验，
    # 但此时必须用 "答案块存在且 schema 所有 key 都出现" 作为最低结构门槛，
    # 避免 L2 继续给默认满分。
    if not (exp_sets or exp_vals or exp_cnts):
        if schema:
            blk = extract_answer_block(output)
            if blk is None or not isinstance(blk, dict):
                return 0.0, {}, ["L2: 无数值断言，且未提供答案块或答案块非对象，记 0"]
            missing = [k for k in schema.keys() if k not in blk]
            ok = 0.0 if missing else 1.0
            items = {f"l2::schema::{k}": 0.0 if k in missing else 1.0 for k in schema}
            return ok, items, [f"L2: 无数值断言，答案块结构完整度 {ok:.0%}（缺 {len(missing)} 字段）"]
        return 1.0, {}, ["L2: 该任务无数值断言且无 schema，记满分（旧版任务/无断言）"]

    blk = extract_answer_block(output)
    if blk is None:
        notes.append("L2: 未找到结构化答案块（```json```），全部数值断言记 0")
        for k in list(exp_sets) + list(exp_vals) + list(exp_cnts):
            items[f"l2::{k}"] = 0.0
        return 0.0, items, notes
    if not isinstance(blk, dict):
        blk = {"_root": blk}

    for key, gold_list in exp_sets.items():
        gold = {_norm(str(x)) for x in gold_list}
        raw = blk.get(key, [])
        if isinstance(raw, dict):
            raw = list(raw.keys())
        if not isinstance(raw, list):
            raw = [raw]
        pred = {_norm(str(x)) for x in raw if str(x).strip()}
        _, _, f = _f1(pred, gold)
        items[f"l2::{key}::f1"] = round(f, 4)
        scores.append(f)

    for key, gold_v in exp_vals.items():
        tol = float(V.get("value_tolerance", 0.02))
        try:
            pv = float(str(blk.get(key, "nan")).replace(",", ""))
            gv = float(gold_v)
            ok = 1.0 if (gv == 0 and pv == 0) else \
                 (1.0 if abs(pv - gv) / max(abs(gv), 1e-9) <= tol else 0.0)
        except (TypeError, ValueError):
            ok = 0.0
        items[f"l2::{key}::val"] = ok
        scores.append(ok)

    for key, min_n in exp_cnts.items():
        raw = blk.get(key, [])
        n = len(raw) if isinstance(raw, (list, dict)) else 0
        ok = 1.0 if n >= int(min_n) else (n / max(int(min_n), 1))
        items[f"l2::{key}::count"] = round(ok, 4)
        scores.append(min(ok, 1.0))

    return (sum(scores) / len(scores)) if scores else 1.0, items, notes


# ── 总分 ──────────────────────────────────────────────────────────────
def score_artifact(output: str, task: Dict, mode: str = "team",
                   llm_judge=None) -> ScoreDetail:
    d = ScoreDetail()
    d.L1, d.L1_items = score_l1(output, task)
    d.L2, d.L2_items, notes = score_l2(output, task)
    d.notes.extend(notes)

    if llm_judge is not None:
        try:
            d.L3, reason = llm_judge.judge(output, task, mode)
            d.notes.append(f"L3 judge: {reason[:200]}")
            d.Q = W_L1 * d.L1 + W_L2 * d.L2 + W_L3 * d.L3
        except Exception as e:                       # judge 失败 → 退化为重归一化
            d.notes.append(f"L3 failed, renormalized: {e}")
            d.L3 = float("nan")
            d.Q = (W_L1 * d.L1 + W_L2 * d.L2) / (W_L1 + W_L2)
    else:
        # 关键修正：不注入常数 0.6，改为在 L1/L2 上重归一化，
        # 避免 CTR = (a+c)/(b+c) 被固定加项拉向 1。
        d.L3 = float("nan")
        d.Q = (W_L1 * d.L1 + W_L2 * d.L2) / (W_L1 + W_L2)

    # TMS：单一定义——全部规范章节命中 且 L2 全项满分。文档/代码/正文三处必须一致。
    d.TMS = (d.L1 >= 1.0) and (d.L2 >= 1.0)
    return d
