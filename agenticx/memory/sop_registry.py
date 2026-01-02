"""
SOPRegistry - 轻量 SOP 存储与召回

参考 JoyAgent `plan_sop.py` 思想，但去除外部依赖（Qdrant/向量服务），
采用内置简单相似度（词袋重叠）与模式选择 (HIGH / COMMON / NO)。

设计目标：
- 无新增依赖，纯 Python 实现
- 提供 SOP 的增删查、相似度召回、模式判定
- 生成可直接注入计划提示的字符串（供 Planner 追加上下文）

模式判定：
- HIGH_MODE: top_score >= high_threshold
- NO_SOP_MODE: top_score < low_threshold
- COMMON_MODE: 介于两者之间

提示格式参考 JoyAgent：
- HIGH_MODE：严格执行召回的 SOP 列表
- COMMON_MODE：参考召回的多个 SOP
- NO_SOP_MODE：给出空白提示，留给上游自由规划

增强功能：
- 去重：添加 SOP 时检查是否已存在
- LRU 缓存：最近查询缓存，减少重复计算
- 评分归一化：确保评分在 [0,1] 范围，模式判定稳定
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, field
from typing import List, Tuple, Optional, Dict
import math
import re


SOPMode = str


@dataclass
class SOPItem:
    """SOP 条目定义"""

    name: str
    description: str
    steps: List[str]
    sop_id: str = field(default_factory=lambda: "")
    vector_hint: Optional[List[float]] = None  # 预留接口，方便未来接入向量


class SOPRegistry:
    """
    轻量 SOP 注册表。

    使用简单词袋重叠相似度，避免引入向量依赖。
    
    增强功能：
    - 去重：添加 SOP 时检查是否已存在（按 name 或 sop_id）
    - LRU 缓存：最近查询缓存（默认 64 条）
    - 评分归一化：确保评分在 [0,1] 范围
    """

    def __init__(
        self,
        high_threshold: float = 0.75,
        low_threshold: float = 0.30,
        max_recall: int = 5,
        cache_size: int = 64,
    ) -> None:
        self._items: List[SOPItem] = []
        self._name_index: Dict[str, int] = {}  # name -> index for dedup
        self._id_index: Dict[str, int] = {}    # sop_id -> index for dedup
        self.high_threshold = high_threshold
        self.low_threshold = low_threshold
        self.max_recall = max_recall
        self._cache_size = cache_size
        self._recall_cache: OrderedDict[str, List[Tuple[SOPItem, float]]] = OrderedDict()

    # --------------------------------------------------------------------- #
    # 基础操作
    # --------------------------------------------------------------------- #
    def add_sop(self, sop: SOPItem, overwrite: bool = False) -> bool:
        """
        添加 SOP，支持去重。
        
        Args:
            sop: SOP 条目
            overwrite: 是否覆盖已存在的 SOP（按 name 或 sop_id 判断）
            
        Returns:
            True 表示成功添加/更新，False 表示已存在且未覆盖
        """
        existing_idx = None
        if sop.name in self._name_index:
            existing_idx = self._name_index[sop.name]
        elif sop.sop_id and sop.sop_id in self._id_index:
            existing_idx = self._id_index[sop.sop_id]
        
        if existing_idx is not None:
            if not overwrite:
                return False
            # 覆盖更新
            old = self._items[existing_idx]
            if old.name in self._name_index:
                del self._name_index[old.name]
            if old.sop_id and old.sop_id in self._id_index:
                del self._id_index[old.sop_id]
            self._items[existing_idx] = sop
        else:
            existing_idx = len(self._items)
            self._items.append(sop)
        
        # 更新索引
        self._name_index[sop.name] = existing_idx
        if sop.sop_id:
            self._id_index[sop.sop_id] = existing_idx
        
        # 清空缓存（内容变更后缓存失效）
        self._recall_cache.clear()
        return True

    def list_sops(self) -> List[SOPItem]:
        return list(self._items)
    
    def get_sop(self, name: str) -> Optional[SOPItem]:
        """按名称获取 SOP"""
        idx = self._name_index.get(name)
        return self._items[idx] if idx is not None else None
    
    @property
    def cache_stats(self) -> Dict[str, int]:
        """返回缓存统计信息"""
        return {"size": len(self._recall_cache), "max_size": self._cache_size}

    # --------------------------------------------------------------------- #
    # 召回与模式判定
    # --------------------------------------------------------------------- #
    def recall(self, query: str, use_cache: bool = True) -> List[Tuple[SOPItem, float]]:
        """
        根据 query 召回最相似的 SOP。
        简单词袋相似度：Jaccard 近似（取重叠词占比）。
        
        Args:
            query: 查询字符串
            use_cache: 是否使用缓存（默认 True）
            
        Returns:
            按相似度降序排列的 (SOP, score) 列表
        """
        query = query.strip()
        if not query:
            return []
        
        # 检查缓存
        if use_cache and query in self._recall_cache:
            # LRU: 移动到末尾
            self._recall_cache.move_to_end(query)
            return self._recall_cache[query]

        query_tokens = self._tokenize(query)
        scored: List[Tuple[SOPItem, float]] = []
        for sop in self._items:
            text = " ".join([sop.name, sop.description, " ".join(sop.steps)])
            # 直接包含关系快速判高分
            if query in text or sop.name in query:
                scored.append((sop, 1.0))
                continue
            sop_tokens = self._tokenize(text)
            score = self._overlap_score(query_tokens, sop_tokens)
            # 归一化确保评分在 [0, 1]
            score = max(0.0, min(1.0, score))
            scored.append((sop, score))

        scored.sort(key=lambda x: x[1], reverse=True)
        result = scored[: self.max_recall]
        
        # 写入缓存
        if use_cache:
            self._recall_cache[query] = result
            # 维护 LRU 大小
            while len(self._recall_cache) > self._cache_size:
                self._recall_cache.popitem(last=False)
        
        return result

    def choose_mode(self, scored: List[Tuple[SOPItem, float]]) -> SOPMode:
        if not scored:
            return "NO_SOP_MODE"
        top_score = scored[0][1]
        if top_score >= self.high_threshold:
            return "HIGH_MODE"
        if top_score < self.low_threshold:
            return "NO_SOP_MODE"
        return "COMMON_MODE"

    # --------------------------------------------------------------------- #
    # 提示生成
    # --------------------------------------------------------------------- #
    def build_prompt(self, query: str) -> Tuple[SOPMode, str]:
        """
        返回 (模式, sop_prompt)，供 Planner 追加到上下文。
        """
        scored = self.recall(query)
        mode = self.choose_mode(scored)

        if mode == "NO_SOP_MODE":
            prompt = (
                "你需要为用户生成一个结构化计划。当前未找到可参考的 SOP，"
                "请结合常识自行拆解任务，确保步骤清晰且可执行。"
            )
            return mode, prompt

        if mode == "HIGH_MODE":
            picked = scored[:2]  # 高相关时选前 2 个即可
            prefix = "以下是标准作业程序（SOP），请严格按照步骤生成计划："
        else:
            picked = scored[: self.max_recall]
            prefix = f"以下提供 {len(picked)} 个参考 SOP，请结合需求生成计划："

        lines = [prefix]
        for idx, (sop, score) in enumerate(picked, start=1):
            lines.append(f"SOP #{idx}: {sop.name} (相似度={score:.2f})")
            lines.append(f"描述: {sop.description}")
            for step_i, step in enumerate(sop.steps, start=1):
                lines.append(f"  步骤{step_i}: {step}")
            lines.append("")  # 空行分隔

        prompt = "\n".join(lines).strip()
        return mode, prompt

    # --------------------------------------------------------------------- #
    # 内部工具
    # --------------------------------------------------------------------- #
    @staticmethod
    def _tokenize(text: str) -> List[str]:
        # 先按词捕获
        word_tokens = re.findall(r"[A-Za-z0-9\u4e00-\u9fa5]+", text.lower())
        # 对每个词进一步拆分 CJK 单字符，增强中文重叠召回
        char_tokens: List[str] = []
        for w in word_tokens:
            # 如果包含中文则按字符拆分；否则保留整词
            if re.search(r"[\u4e00-\u9fa5]", w):
                char_tokens.extend(list(w))
            else:
                char_tokens.append(w)
        return char_tokens or word_tokens

    @staticmethod
    def _overlap_score(a: List[str], b: List[str]) -> float:
        if not a or not b:
            return 0.0
        # 如果存在明显的包含关系，直接给高分
        if "".join(a) in "".join(b) or "".join(b) in "".join(a):
            return 1.0
        set_a, set_b = set(a), set(b)
        inter = len(set_a & set_b)
        union = len(set_a | set_b)
        if union == 0:
            return 0.0
        # Jaccard 近似
        jaccard = inter / union
        # 只要有交集，给一个较高的下限，提升召回模式为 HIGH
        if inter > 0:
            return max(jaccard, 0.8)
        # 轻微平滑，避免过分偏小
        return round(jaccard, 4)


__all__ = ["SOPRegistry", "SOPItem", "SOPMode"]

