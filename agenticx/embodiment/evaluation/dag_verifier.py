"""
DAGVerifier - 基于 DAG 的任务验证器
基于 MobiAgent MobiFlow 设计

核心思想：
- DAG 双语义依赖（deps: AND, next: OR）
- 路径感知帧收集
- 多级验证策略（text → OCR → LLM）

来源：MobiAgent 框架
"""

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional
from pydantic import BaseModel, Field  # type: ignore
from collections import deque
import logging

logger = logging.getLogger(__name__)


class DAGNode(BaseModel):
    """DAG 节点
    
    Attributes:
        id: 节点唯一标识
        description: 节点描述（可用于 LLM 验证）
        condition: 验证条件（字典格式）
        deps: 前置依赖（AND 语义，所有依赖都满足才能验证此节点）
        next: 后继节点（OR 语义，满足任一后继即可继续）
        score: 节点分数（用于计算任务完成度）
    """
    id: str = Field(description="节点唯一标识")
    description: Optional[str] = Field(default=None, description="节点描述")
    condition: Optional[Dict[str, Any]] = Field(default=None, description="验证条件")
    deps: Optional[List[str]] = Field(default=None, description="前置依赖 (AND 语义)")
    next: Optional[List[str]] = Field(default=None, description="后继节点 (OR 语义)")
    score: int = Field(default=1, description="节点分数")
    
    model_config = {"extra": "allow"}


class DAGTaskSpec(BaseModel):
    """DAG 任务规范
    
    定义任务的完整 DAG 结构，包括节点和成功条件。
    
    Attributes:
        nodes: DAG 节点列表
        success_any_of: 成功条件（满足任一节点即成功）
        success_all_of: 成功条件（满足所有节点才成功）
    
    Example:
        >>> spec = DAGTaskSpec(
        ...     nodes=[
        ...         DAGNode(id="open_app", description="打开应用"),
        ...         DAGNode(id="search", deps=["open_app"], description="搜索"),
        ...         DAGNode(id="click_result", deps=["search"]),
        ...     ],
        ...     success_all_of=["click_result"]
        ... )
    """
    nodes: List[DAGNode] = Field(default_factory=list, description="DAG 节点列表")
    success_any_of: Optional[List[str]] = Field(default=None, description="成功条件 (OR)")
    success_all_of: Optional[List[str]] = Field(default=None, description="成功条件 (AND)")
    
    def get_node(self, node_id: str) -> Optional[DAGNode]:
        """获取节点"""
        for node in self.nodes:
            if node.id == node_id:
                return node
        return None
    
    def get_entry_nodes(self) -> List[DAGNode]:
        """获取入口节点（无依赖的节点）"""
        return [node for node in self.nodes if not node.deps]
    
    def validate_structure(self) -> List[str]:
        """验证 DAG 结构
        
        Returns:
            错误消息列表
        """
        errors = []
        node_ids = {node.id for node in self.nodes}
        
        for node in self.nodes:
            # 检查依赖节点是否存在
            if node.deps:
                for dep in node.deps:
                    if dep not in node_ids:
                        errors.append(f"Node '{node.id}' has unknown dep '{dep}'")
            
            # 检查后继节点是否存在
            if node.next:
                for next_id in node.next:
                    if next_id not in node_ids:
                        errors.append(f"Node '{node.id}' has unknown next '{next_id}'")
        
        # 检查成功条件
        if self.success_any_of:
            for node_id in self.success_any_of:
                if node_id not in node_ids:
                    errors.append(f"success_any_of contains unknown node '{node_id}'")
        
        if self.success_all_of:
            for node_id in self.success_all_of:
                if node_id not in node_ids:
                    errors.append(f"success_all_of contains unknown node '{node_id}'")
        
        return errors


@dataclass
class DAGVerifyResult:
    """验证结果
    
    Attributes:
        ok: 是否验证通过
        matched_nodes: 匹配的节点 ID 列表
        total_score: 总分数
        max_score: 最大可能分数
        reason: 验证原因/说明
        details: 详细信息
    """
    ok: bool = False
    matched_nodes: List[str] = field(default_factory=list)
    total_score: int = 0
    max_score: int = 0
    reason: Optional[str] = None
    details: Dict[str, Any] = field(default_factory=dict)
    
    @property
    def completion_ratio(self) -> float:
        """计算完成度"""
        return self.total_score / self.max_score if self.max_score > 0 else 0.0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "ok": self.ok,
            "matched_nodes": self.matched_nodes,
            "total_score": self.total_score,
            "max_score": self.max_score,
            "completion_ratio": self.completion_ratio,
            "reason": self.reason,
            "details": self.details,
        }


class DAGVerifier:
    """
    基于 DAG 的任务验证器 - 基于 MobiAgent MobiFlow 设计
    
    与 AgenticX evaluation 模块的集成：
    - 输入帧格式与 TrajectoryMatcher 一致
    - 支持多级验证（text → OCR → LLM），复用 LLMJudge
    - 结果可聚合到 EvaluationRunner
    
    验证流程：
    1. 拓扑排序 DAG 节点
    2. 按顺序验证每个节点的条件
    3. 根据成功条件判断整体是否通过
    
    Example:
        >>> spec = DAGTaskSpec(
        ...     nodes=[
        ...         DAGNode(id="open_app", description="打开应用"),
        ...         DAGNode(id="search", deps=["open_app"]),
        ...         DAGNode(id="click_result", deps=["search"]),
        ...     ],
        ...     success_all_of=["click_result"]
        ... )
        >>> verifier = DAGVerifier(spec)
        >>> result = verifier.verify(frames)
    """
    
    def __init__(
        self,
        task_spec: DAGTaskSpec,
        condition_checker: Optional[Callable[[Dict, Dict], bool]] = None,
        llm_judge: Optional[Any] = None,
    ):
        """初始化验证器
        
        Args:
            task_spec: DAG 任务规范
            condition_checker: 条件检查器（可选）
            llm_judge: LLM 判断器（用于复杂验证）
        """
        self.task_spec = task_spec
        self.condition_checker = condition_checker or self._default_condition_checker
        self.llm_judge = llm_judge
        
        # 验证结构
        errors = task_spec.validate_structure()
        if errors:
            logger.warning(f"DAG structure has issues: {errors}")
        
        # 构建依赖图
        self._dep_graph = self._build_dependency_graph()
        
        # 计算最大分数
        self._max_score = sum(node.score for node in task_spec.nodes)
    
    def _build_dependency_graph(self) -> Dict[str, List[str]]:
        """构建依赖图
        
        Returns:
            {node_id: [dependent_node_ids]}
        """
        graph = {}
        for node in self.task_spec.nodes:
            graph[node.id] = node.deps or []
        return graph
    
    def verify(self, frames: List[Dict[str, Any]]) -> DAGVerifyResult:
        """验证帧序列
        
        Args:
            frames: 帧序列，每帧包含 screenshot、ocr_text 等信息
            
        Returns:
            DAGVerifyResult: 验证结果
        """
        if not frames:
            return DAGVerifyResult(
                ok=False,
                max_score=self._max_score,
                reason="No frames to verify"
            )
        
        # 获取拓扑排序
        sorted_nodes = self._topological_sort()
        
        # 已匹配的节点
        matched_nodes: List[str] = []
        node_details: Dict[str, Any] = {}
        
        # 按拓扑顺序验证每个节点
        for node_id in sorted_nodes:
            node = self.task_spec.get_node(node_id)
            if not node:
                continue
            
            # 检查依赖是否满足
            if node.deps:
                deps_met = all(dep in matched_nodes for dep in node.deps)
                if not deps_met:
                    node_details[node_id] = {"status": "deps_not_met"}
                    continue
            
            # 验证节点条件
            is_matched, match_frame_idx = self._verify_node(node, frames)
            
            if is_matched:
                matched_nodes.append(node_id)
                node_details[node_id] = {
                    "status": "matched",
                    "frame_idx": match_frame_idx
                }
            else:
                node_details[node_id] = {"status": "not_matched"}
        
        # 计算得分
        total_score = sum(
            self.task_spec.get_node(nid).score
            for nid in matched_nodes
            if self.task_spec.get_node(nid)
        )
        
        # 判断是否成功
        ok = self._check_success_condition(matched_nodes)
        
        return DAGVerifyResult(
            ok=ok,
            matched_nodes=matched_nodes,
            total_score=total_score,
            max_score=self._max_score,
            reason="Success" if ok else "Success condition not met",
            details={"node_details": node_details}
        )
    
    def _verify_node(
        self,
        node: DAGNode,
        frames: List[Dict[str, Any]]
    ) -> tuple[bool, Optional[int]]:
        """验证单个节点
        
        Args:
            node: DAG 节点
            frames: 帧序列
            
        Returns:
            (是否匹配, 匹配的帧索引)
        """
        # 遍历帧查找匹配
        for idx, frame in enumerate(frames):
            if self._check_node_condition(node, frame):
                return (True, idx)
        
        return (False, None)
    
    def _check_node_condition(self, node: DAGNode, frame: Dict[str, Any]) -> bool:
        """检查节点条件是否满足
        
        支持多级验证：
        1. 条件字典匹配
        2. 文本/OCR 匹配
        3. LLM 判断（如果配置）
        
        Args:
            node: DAG 节点
            frame: 帧数据
            
        Returns:
            是否满足条件
        """
        # 如果没有条件，使用描述进行文本匹配
        if not node.condition and node.description:
            # 尝试 OCR 文本匹配
            ocr_text = frame.get("ocr_text", "") or ""
            if node.description.lower() in ocr_text.lower():
                return True
            
            # 尝试 LLM 判断
            if self.llm_judge:
                try:
                    return self._llm_verify(node.description, frame)
                except Exception as e:
                    logger.warning(f"LLM verification failed: {e}")
            
            return False
        
        # 使用条件检查器
        if node.condition:
            return self.condition_checker(node.condition, frame)
        
        # 无条件的节点默认通过
        return True
    
    def _default_condition_checker(
        self,
        condition: Dict[str, Any],
        frame: Dict[str, Any]
    ) -> bool:
        """默认条件检查器
        
        支持的条件格式：
        - {"text_contains": "关键词"}
        - {"element_exists": "元素ID"}
        - {"ocr_contains": "文本"}
        
        Args:
            condition: 条件字典
            frame: 帧数据
            
        Returns:
            是否满足条件
        """
        # 文本包含检查
        if "text_contains" in condition:
            text = frame.get("ocr_text", "") or ""
            return condition["text_contains"].lower() in text.lower()
        
        # 元素存在检查
        if "element_exists" in condition:
            elements = frame.get("elements", []) or []
            element_ids = [e.get("id") or e.get("element_id") for e in elements]
            return condition["element_exists"] in element_ids
        
        # OCR 包含检查
        if "ocr_contains" in condition:
            ocr_text = frame.get("ocr_text", "") or ""
            return condition["ocr_contains"].lower() in ocr_text.lower()
        
        # 自定义条件（直接比较帧属性）
        for key, value in condition.items():
            if key in frame and frame[key] != value:
                return False
        
        return True
    
    def _llm_verify(self, description: str, frame: Dict[str, Any]) -> bool:
        """使用 LLM 验证
        
        Args:
            description: 节点描述
            frame: 帧数据
            
        Returns:
            是否满足
        """
        # TODO: 集成 LLMJudge
        return False
    
    def _topological_sort(self) -> List[str]:
        """拓扑排序 DAG 节点
        
        Returns:
            排序后的节点 ID 列表
        """
        # 计算入度
        in_degree = {node.id: 0 for node in self.task_spec.nodes}
        for node in self.task_spec.nodes:
            if node.deps:
                for dep in node.deps:
                    if dep in in_degree:
                        # dep 被 node 依赖，所以 node 的入度增加
                        pass
        
        # 重新计算：每个节点的入度 = 它的依赖数量
        for node in self.task_spec.nodes:
            in_degree[node.id] = len(node.deps) if node.deps else 0
        
        # BFS 拓扑排序
        queue = deque([nid for nid, deg in in_degree.items() if deg == 0])
        result = []
        
        while queue:
            node_id = queue.popleft()
            result.append(node_id)
            
            # 找到所有以 node_id 为依赖的节点
            for node in self.task_spec.nodes:
                if node.deps and node_id in node.deps:
                    in_degree[node.id] -= 1
                    if in_degree[node.id] == 0:
                        queue.append(node.id)
        
        return result
    
    def _check_success_condition(self, matched_nodes: List[str]) -> bool:
        """检查成功条件
        
        Args:
            matched_nodes: 已匹配的节点列表
            
        Returns:
            是否满足成功条件
        """
        matched_set = set(matched_nodes)
        
        # success_any_of: 满足任一即成功
        if self.task_spec.success_any_of:
            if any(nid in matched_set for nid in self.task_spec.success_any_of):
                return True
        
        # success_all_of: 满足所有才成功
        if self.task_spec.success_all_of:
            if all(nid in matched_set for nid in self.task_spec.success_all_of):
                return True
            return False
        
        # 如果没有明确的成功条件，检查是否所有节点都匹配
        if not self.task_spec.success_any_of and not self.task_spec.success_all_of:
            return len(matched_nodes) == len(self.task_spec.nodes)
        
        return False
