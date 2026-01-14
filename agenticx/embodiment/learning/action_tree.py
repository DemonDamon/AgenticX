"""
ActionTree - 动作树数据结构
基于 MobiAgent AgentRR 设计

核心思想：
- 树状结构存储历史执行轨迹
- 每条边关联动作和任务列表
- 相同动作的不同任务自动合并
- 支持精确匹配和模糊匹配（基于任务嵌入）

来源：MobiAgent 框架
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
import logging
import hashlib

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False
    np = None

logger = logging.getLogger(__name__)


@dataclass
class CachedAction:
    """缓存的动作记录
    
    记录单个动作的详细信息，用于缓存查找和回放。
    
    Attributes:
        name: 动作名称（如 "click", "type"）
        params: 动作参数
        target_element: 目标元素描述（可选）
        confidence: 置信度 [0, 1]
        step: 步骤索引
        task_embedding: 任务嵌入向量（用于模糊匹配）
        metadata: 额外元数据
    """
    name: str
    params: Dict[str, Any]
    target_element: Optional[str] = None
    confidence: float = 1.0
    step: int = 0
    task_embedding: Optional[List[float]] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def get_signature(self) -> str:
        """获取动作签名（用于精确匹配）
        
        Returns:
            动作签名字符串
        """
        # 简化参数，只保留关键字段
        key_params = {}
        for key in ["element_id", "text", "direction", "x", "y"]:
            if key in self.params:
                value = self.params[key]
                # 截断长文本
                if isinstance(value, str) and len(value) > 20:
                    value = value[:20]
                key_params[key] = value
        
        # 生成签名
        param_str = str(sorted(key_params.items()))
        return f"{self.name}:{param_str}"
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "name": self.name,
            "params": self.params,
            "target_element": self.target_element,
            "confidence": self.confidence,
            "step": self.step,
            "task_embedding": self.task_embedding,
            "metadata": self.metadata,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CachedAction":
        """从字典创建"""
        return cls(
            name=data["name"],
            params=data["params"],
            target_element=data.get("target_element"),
            confidence=data.get("confidence", 1.0),
            step=data.get("step", 0),
            task_embedding=data.get("task_embedding"),
            metadata=data.get("metadata", {}),
        )


@dataclass
class ActionTreeEdge:
    """动作树边
    
    连接两个节点的边，关联一个动作和多个任务。
    
    Attributes:
        action: 缓存的动作
        tasks: 使用此动作的任务列表
        task_embeddings: 任务嵌入矩阵（可选，用于模糊匹配）
        target_node_id: 目标节点 ID
    """
    action: CachedAction
    tasks: List[str] = field(default_factory=list)
    task_embeddings: Optional[Any] = None  # numpy array or None
    target_node_id: Optional[str] = None
    
    def add_task(self, task: str, task_embedding: Optional[List[float]] = None) -> None:
        """添加任务
        
        Args:
            task: 任务描述
            task_embedding: 任务嵌入（可选）
        """
        if task not in self.tasks:
            self.tasks.append(task)
            
            # 更新嵌入矩阵
            if task_embedding and HAS_NUMPY:
                if self.task_embeddings is None:
                    self.task_embeddings = np.array([task_embedding])
                else:
                    self.task_embeddings = np.vstack([self.task_embeddings, task_embedding])
    
    def match_task(
        self,
        task: str,
        task_embedding: Optional[List[float]] = None,
        threshold: float = 0.8
    ) -> Tuple[bool, float]:
        """匹配任务
        
        先尝试精确匹配，失败后尝试嵌入相似度匹配。
        
        Args:
            task: 任务描述
            task_embedding: 任务嵌入（可选）
            threshold: 相似度阈值
            
        Returns:
            (是否匹配, 相似度分数)
        """
        # 精确匹配
        if task in self.tasks:
            return (True, 1.0)
        
        # 嵌入匹配
        if task_embedding and self.task_embeddings is not None and HAS_NUMPY:
            query_vec = np.array(task_embedding)
            # 计算余弦相似度
            similarities = np.dot(self.task_embeddings, query_vec) / (
                np.linalg.norm(self.task_embeddings, axis=1) * np.linalg.norm(query_vec) + 1e-8
            )
            max_sim = np.max(similarities)
            if max_sim >= threshold:
                return (True, float(max_sim))
        
        return (False, 0.0)


@dataclass
class ActionTreeNode:
    """动作树节点
    
    树中的一个状态节点，可以有多条出边（代表不同的动作）。
    
    Attributes:
        node_id: 节点唯一标识
        edges: 出边列表
        parent: 父节点（可选）
        depth: 节点深度
        state_hash: 状态哈希（可选，用于状态对比）
    """
    node_id: str
    edges: List[ActionTreeEdge] = field(default_factory=list)
    parent: Optional["ActionTreeNode"] = None
    depth: int = 0
    state_hash: Optional[str] = None
    
    def add_edge(self, edge: ActionTreeEdge) -> None:
        """添加出边"""
        self.edges.append(edge)
    
    def find_edge_by_action(self, action_signature: str) -> Optional[ActionTreeEdge]:
        """根据动作签名查找边
        
        Args:
            action_signature: 动作签名
            
        Returns:
            匹配的边或 None
        """
        for edge in self.edges:
            if edge.action.get_signature() == action_signature:
                return edge
        return None


class ActionTree:
    """
    动作树 - 用于动作缓存的高效检索
    
    不变式：
    - I1: 树结构天然无环（每个节点只有一个父节点）
    - I2: 相似度随深度递增要求更高（深度越大，匹配阈值越高）
    - I3: 相同动作签名的边在同一节点只出现一次（自动合并）
    
    与 AgenticX 架构的集成：
    - 使用 MemoryComponent 持久化
    - 支持精确匹配（基于动作签名）和模糊匹配（基于任务嵌入）
    - 与 ActionCache 配合使用
    
    Example:
        >>> tree = ActionTree()
        >>> actions = [
        ...     CachedAction("click", {"x": 100}, step=0),
        ...     CachedAction("type", {"text": "hello"}, step=1),
        ... ]
        >>> tree.add_trajectory("搜索任务", actions)
        >>> cached, score = tree.find_cached_action("搜索任务", step=0)
    """
    
    def __init__(self):
        """初始化动作树"""
        # 根节点（初始状态）
        self.root = ActionTreeNode(node_id="root", depth=0)
        
        # 节点索引（用于快速查找）
        self._nodes: Dict[str, ActionTreeNode] = {"root": self.root}
        
        # 统计信息
        self._stats = {
            "total_trajectories": 0,
            "total_nodes": 1,
            "total_edges": 0,
            "max_depth": 0,
        }
    
    def add_trajectory(
        self,
        task: str,
        actions: List[CachedAction],
        task_embedding: Optional[List[float]] = None
    ) -> None:
        """添加轨迹到树中
        
        遍历动作序列，如果路径存在则合并任务，否则创建新路径。
        
        Args:
            task: 任务描述
            actions: 动作序列
            task_embedding: 任务嵌入（可选）
        """
        current_node = self.root
        
        for step, action in enumerate(actions):
            action_signature = action.get_signature()
            
            # 查找是否已有相同动作的边
            edge = current_node.find_edge_by_action(action_signature)
            
            if edge:
                # 边已存在，添加任务
                edge.add_task(task, task_embedding)
                
                # 移动到目标节点
                if edge.target_node_id:
                    current_node = self._nodes[edge.target_node_id]
                else:
                    # 边还没有目标节点，创建一个
                    next_node = self._create_node(current_node, step + 1)
                    edge.target_node_id = next_node.node_id
                    current_node = next_node
            else:
                # 创建新边和新节点
                next_node = self._create_node(current_node, step + 1)
                new_edge = ActionTreeEdge(
                    action=action,
                    tasks=[task],
                    target_node_id=next_node.node_id
                )
                if task_embedding:
                    new_edge.add_task(task, task_embedding)
                
                current_node.add_edge(new_edge)
                self._stats["total_edges"] += 1
                
                current_node = next_node
        
        # 更新统计
        self._stats["total_trajectories"] += 1
        self._stats["max_depth"] = max(self._stats["max_depth"], len(actions))
    
    def _create_node(self, parent: ActionTreeNode, depth: int) -> ActionTreeNode:
        """创建新节点
        
        Args:
            parent: 父节点
            depth: 深度
            
        Returns:
            新创建的节点
        """
        # 生成节点 ID
        node_id = f"node_{self._stats['total_nodes']}"
        
        # 创建节点
        node = ActionTreeNode(
            node_id=node_id,
            parent=parent,
            depth=depth
        )
        
        # 添加到索引
        self._nodes[node_id] = node
        self._stats["total_nodes"] += 1
        
        return node
    
    def find_cached_action(
        self,
        task: str,
        step: int,
        task_embedding: Optional[List[float]] = None,
        threshold: float = 0.8
    ) -> Optional[Tuple[CachedAction, float]]:
        """查找缓存的动作
        
        从根节点开始，沿着匹配的边向下查找到指定步骤。
        
        Args:
            task: 任务描述
            step: 步骤索引
            task_embedding: 任务嵌入（可选）
            threshold: 相似度阈值（随深度递增）
            
        Returns:
            (缓存的动作, 匹配分数) 或 None
        """
        current_node = self.root
        accumulated_score = 1.0
        
        # 沿着树向下查找
        for current_step in range(step + 1):
            # 随深度递增相似度要求
            step_threshold = threshold + (current_step * 0.05)  # 每一步提高 5%
            step_threshold = min(step_threshold, 0.95)  # 最高 0.95
            
            # 查找匹配的边
            best_edge = None
            best_score = 0.0
            
            for edge in current_node.edges:
                matched, score = edge.match_task(task, task_embedding, step_threshold)
                if matched and score > best_score:
                    best_edge = edge
                    best_score = score
            
            if not best_edge:
                # 没有找到匹配的边，查找失败
                return None
            
            # 更新累积分数
            accumulated_score *= best_score
            
            # 如果是目标步骤，返回动作
            if current_step == step:
                return (best_edge.action, accumulated_score)
            
            # 移动到下一个节点
            if best_edge.target_node_id:
                current_node = self._nodes[best_edge.target_node_id]
            else:
                # 边没有目标节点，查找失败
                return None
        
        return None
    
    def get_statistics(self) -> Dict[str, Any]:
        """获取统计信息
        
        Returns:
            统计信息字典
        """
        return self._stats.copy()
    
    def clear(self) -> None:
        """清空树"""
        self.root = ActionTreeNode(node_id="root", depth=0)
        self._nodes = {"root": self.root}
        self._stats = {
            "total_trajectories": 0,
            "total_nodes": 1,
            "total_edges": 0,
            "max_depth": 0,
        }
    
    def __len__(self) -> int:
        """返回节点数量"""
        return self._stats["total_nodes"]
    
    def __repr__(self) -> str:
        return (
            f"ActionTree(nodes={self._stats['total_nodes']}, "
            f"edges={self._stats['total_edges']}, "
            f"trajectories={self._stats['total_trajectories']})"
        )
