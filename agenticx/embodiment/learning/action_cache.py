"""
ActionCache - 动作缓存管理器
基于 MobiAgent AgentRR 设计

职责：
- 缓存历史执行轨迹（ActionTree 结构）
- 支持精确匹配和模糊匹配（步骤级任务嵌入）
- 通过 Hooks 系统透明集成到执行循环
- 使用 MemoryComponent 持久化

来源：MobiAgent 框架
"""

from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple
import logging

from agenticx.core.component import Component
from agenticx.embodiment.core.models import ScreenState, GUIAction
from agenticx.embodiment.learning.action_tree import (
    ActionTree,
    CachedAction,
)

logger = logging.getLogger(__name__)


class MatchMode(Enum):
    """匹配模式"""
    EXACT = "exact"   # 精确匹配（基于动作签名）
    FUZZY = "fuzzy"   # 模糊匹配（基于任务嵌入）


class ActionCache(Component):
    """
    动作缓存管理器 - 继承自 Component
    
    基于 MobiAgent AgentRR 设计，使用动作树缓存历史轨迹。
    
    与 AgenticX 现有组件的集成：
    - 继承 Component 基类，支持生命周期管理
    - 使用 MemoryComponent 作为持久化后端（可选）
    - 通过 Hooks 系统注入缓存查找/记录
    - 与 EpisodicMemory 配合存储轨迹
    
    工作流程：
    1. 在动作执行前，查询缓存是否有匹配的动作
    2. 如果命中，直接使用缓存的动作参数
    3. 动作执行后，记录到缓存
    
    Example:
        >>> cache = ActionCache(
        ...     mode=MatchMode.FUZZY,
        ...     similarity_threshold=0.8
        ... )
        >>> 
        >>> # 方式1：显式调用
        >>> cached = await cache.lookup(task, step, screen_state)
        >>> if cached:
        ...     action, score = cached
        ...     print(f"缓存命中: {action.name}, 分数: {score}")
        >>> 
        >>> # 方式2：透明集成（通过 Hooks）
        >>> cache.register_hooks(gui_agent)
    """
    
    def __init__(
        self,
        name: str = "action_cache",
        mode: MatchMode = MatchMode.EXACT,
        memory: Optional[Any] = None,
        similarity_threshold: float = 0.8,
        embedder_model: Optional[str] = None,
        enable_auto_recording: bool = True,
        max_cache_size: int = 1000,
        **kwargs,
    ):
        """初始化动作缓存
        
        Args:
            name: 组件名称
            mode: 匹配模式（精确或模糊）
            memory: MemoryComponent 实例（用于持久化）
            similarity_threshold: 相似度阈值（用于模糊匹配）
            embedder_model: 嵌入模型名称（用于模糊匹配）
            enable_auto_recording: 是否自动记录动作
            max_cache_size: 最大缓存轨迹数量
        """
        super().__init__(name=name, **kwargs)
        self.mode = mode
        self.memory = memory
        self.similarity_threshold = similarity_threshold
        self.embedder_model = embedder_model
        self.enable_auto_recording = enable_auto_recording
        self.max_cache_size = max_cache_size
        
        # 动作树
        self._action_tree = ActionTree()
        
        # 嵌入器（延迟加载）
        self._embedder = None
        
        # 统计信息
        self._stats = {
            "total_lookups": 0,
            "cache_hits": 0,
            "cache_misses": 0,
            "total_recordings": 0,
        }
        
        # Hooks
        self._lookup_hooks: List[Callable] = []
        self._record_hooks: List[Callable] = []
    
    async def initialize(self):
        """初始化组件"""
        await super().initialize()
        
        # 如果使用模糊匹配，初始化嵌入器
        if self.mode == MatchMode.FUZZY and self.embedder_model:
            await self._initialize_embedder()
        
        # 如果配置了 memory，从持久化存储加载
        if self.memory:
            await self._load_from_memory()
    
    async def _initialize_embedder(self):
        """初始化嵌入器（延迟加载）"""
        try:
            # 尝试导入 sentence-transformers
            from sentence_transformers import SentenceTransformer
            
            logger.info(f"Loading embedder model: {self.embedder_model}")
            self._embedder = SentenceTransformer(self.embedder_model)
            logger.info("Embedder loaded successfully")
        except ImportError:
            logger.warning(
                "sentence-transformers not installed. "
                "Fuzzy matching will not work. "
                "Install with: pip install sentence-transformers"
            )
            self._embedder = None
        except Exception as e:
            logger.error(f"Failed to load embedder model: {e}")
            self._embedder = None
    
    async def _load_from_memory(self):
        """从持久化存储加载缓存"""
        if not self.memory:
            return
        
        try:
            # 从 memory 加载缓存数据
            cache_data = await self.memory.get("action_cache_tree")
            if cache_data:
                # TODO: 实现序列化/反序列化
                logger.info("Loaded action cache from memory")
        except Exception as e:
            logger.warning(f"Failed to load action cache from memory: {e}")
    
    async def lookup(
        self,
        task: str,
        step: int,
        screen_state: Optional[ScreenState] = None
    ) -> Optional[Tuple[CachedAction, float]]:
        """查找缓存的动作
        
        Args:
            task: 任务描述
            step: 步骤索引
            screen_state: 当前屏幕状态（可选）
            
        Returns:
            (缓存的动作, 匹配分数) 或 None
        """
        self._stats["total_lookups"] += 1
        
        # 生成任务嵌入（如果需要）
        task_embedding = None
        if self.mode == MatchMode.FUZZY and self._embedder:
            task_embedding = await self._embed_text(task)
        
        # 查找缓存
        result = self._action_tree.find_cached_action(
            task=task,
            step=step,
            task_embedding=task_embedding,
            threshold=self.similarity_threshold
        )
        
        if result:
            self._stats["cache_hits"] += 1
            logger.info(f"Cache hit: task={task[:50]}, step={step}, score={result[1]:.3f}")
            
            # 触发 lookup hooks
            for hook in self._lookup_hooks:
                try:
                    hook(task, step, result)
                except Exception as e:
                    logger.warning(f"Lookup hook failed: {e}")
        else:
            self._stats["cache_misses"] += 1
            logger.debug(f"Cache miss: task={task[:50]}, step={step}")
        
        return result
    
    async def record(
        self,
        task: str,
        step: int,
        action: GUIAction,
        screen_state_before: Optional[ScreenState] = None,
        screen_state_after: Optional[ScreenState] = None,
        outcome: Optional[Any] = None
    ) -> None:
        """记录动作到缓存
        
        Args:
            task: 任务描述
            step: 步骤索引
            action: 执行的动作
            screen_state_before: 执行前屏幕状态
            screen_state_after: 执行后屏幕状态
            outcome: 动作结果（可选）
        """
        if not self.enable_auto_recording:
            return
        
        self._stats["total_recordings"] += 1
        
        # 创建 CachedAction
        cached_action = CachedAction(
            name=action.action_type,
            params=action.parameters,
            step=step,
            confidence=1.0 if outcome and hasattr(outcome, "is_successful") and outcome.is_successful else 0.8,
            metadata={
                "timestamp": action.timestamp.isoformat() if hasattr(action, "timestamp") else None,
                "success": action.success if hasattr(action, "success") else True,
            }
        )
        
        # 生成任务嵌入（如果需要）
        task_embedding = None
        if self.mode == MatchMode.FUZZY and self._embedder:
            task_embedding = await self._embed_text(task)
            cached_action.task_embedding = task_embedding
        
        # 暂时存储，等到任务完成后添加完整轨迹
        # 这里简化处理：每个动作单独作为一条轨迹
        self._action_tree.add_trajectory(
            task=task,
            actions=[cached_action],
            task_embedding=task_embedding
        )
        
        logger.debug(f"Recorded action: task={task[:50]}, step={step}, action={action.action_type}")
        
        # 触发 record hooks
        for hook in self._record_hooks:
            try:
                hook(task, step, cached_action)
            except Exception as e:
                logger.warning(f"Record hook failed: {e}")
        
        # 持久化到 memory（如果配置）
        if self.memory:
            await self._save_to_memory()
    
    async def record_trajectory(
        self,
        task: str,
        actions: List[GUIAction],
        task_embedding: Optional[List[float]] = None
    ) -> None:
        """记录完整轨迹
        
        Args:
            task: 任务描述
            actions: 动作序列
            task_embedding: 任务嵌入（可选）
        """
        # 转换为 CachedAction 列表
        cached_actions = []
        for step, action in enumerate(actions):
            cached_action = CachedAction(
                name=action.action_type,
                params=action.parameters,
                step=step,
                confidence=1.0 if action.success else 0.8,
            )
            cached_actions.append(cached_action)
        
        # 生成任务嵌入（如果需要且没有提供）
        if task_embedding is None and self.mode == MatchMode.FUZZY and self._embedder:
            task_embedding = await self._embed_text(task)
        
        # 添加到树
        self._action_tree.add_trajectory(
            task=task,
            actions=cached_actions,
            task_embedding=task_embedding
        )
        
        self._stats["total_recordings"] += len(actions)
        logger.info(f"Recorded trajectory: task={task[:50]}, steps={len(actions)}")
        
        # 持久化
        if self.memory:
            await self._save_to_memory()
    
    async def _embed_text(self, text: str) -> Optional[List[float]]:
        """生成文本嵌入
        
        Args:
            text: 文本
            
        Returns:
            嵌入向量或 None
        """
        if not self._embedder:
            return None
        
        try:
            embedding = self._embedder.encode(text, convert_to_numpy=True)
            return embedding.tolist()
        except Exception as e:
            logger.error(f"Failed to embed text: {e}")
            return None
    
    async def _save_to_memory(self):
        """保存缓存到持久化存储"""
        if not self.memory:
            return
        
        try:
            # TODO: 实现序列化
            # await self.memory.set("action_cache_tree", cache_data)
            pass
        except Exception as e:
            logger.warning(f"Failed to save action cache to memory: {e}")
    
    def register_lookup_hook(self, hook: Callable) -> None:
        """注册查找钩子
        
        Args:
            hook: 回调函数 (task, step, result) -> None
        """
        self._lookup_hooks.append(hook)
    
    def register_record_hook(self, hook: Callable) -> None:
        """注册记录钩子
        
        Args:
            hook: 回调函数 (task, step, action) -> None
        """
        self._record_hooks.append(hook)
    
    def get_statistics(self) -> Dict[str, Any]:
        """获取统计信息
        
        Returns:
            统计信息字典
        """
        stats = self._stats.copy()
        
        # 计算命中率
        if stats["total_lookups"] > 0:
            stats["hit_rate"] = stats["cache_hits"] / stats["total_lookups"]
        else:
            stats["hit_rate"] = 0.0
        
        # 添加树的统计
        stats["tree_stats"] = self._action_tree.get_statistics()
        
        return stats
    
    def clear_cache(self) -> None:
        """清空缓存"""
        self._action_tree.clear()
        logger.info("Action cache cleared")
    
    def __repr__(self) -> str:
        return (
            f"ActionCache(mode={self.mode.value}, "
            f"hits={self._stats['cache_hits']}, "
            f"misses={self._stats['cache_misses']})"
        )
