"""M4 工具系统智能化优化的数据模型

定义任务复杂度、性能指标、工具链等核心数据结构。
"""

from enum import Enum
from typing import List, Dict, Any, Optional
from datetime import datetime
from pydantic import BaseModel, Field

from ...core.task import Task


class TaskComplexity(str, Enum):
    """任务复杂度枚举"""
    SIMPLE = "simple"          # 简单任务，单工具可完成
    MODERATE = "moderate"      # 中等复杂度，需要2-3个工具
    COMPLEX = "complex"        # 复杂任务，需要多个工具协作
    VERY_COMPLEX = "very_complex"  # 极复杂任务，需要动态工具链


class TaskFeatures(BaseModel):
    """任务特征模型"""
    complexity: TaskComplexity
    domain: str = Field(description="任务领域，如'data_analysis', 'web_scraping'等")
    required_capabilities: List[str] = Field(description="所需能力列表")
    estimated_duration: Optional[float] = Field(None, description="预估执行时间（秒）")
    priority: int = Field(1, description="任务优先级，1-10")
    resource_requirements: Dict[str, Any] = Field(default_factory=dict, description="资源需求")


class ToolResult(BaseModel):
    """工具执行结果模型"""
    tool_name: str
    success: bool
    execution_time: float = Field(description="执行时间（秒）")
    result_data: Any = Field(None, description="执行结果数据")
    error_message: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.now)
    resource_usage: Dict[str, Any] = Field(default_factory=dict, description="资源使用情况")


class PerformanceMetrics(BaseModel):
    """工具性能指标模型"""
    tool_name: str
    success_rate: float = Field(description="成功率 (0.0-1.0)")
    avg_execution_time: float = Field(description="平均执行时间（秒）")
    total_executions: int = Field(description="总执行次数")
    error_rate: float = Field(description="错误率 (0.0-1.0)")
    last_updated: datetime = Field(default_factory=datetime.now)
    domain_performance: Dict[str, float] = Field(default_factory=dict, description="不同领域的性能")


class ToolChainStep(BaseModel):
    """工具链步骤模型"""
    tool_name: str = Field(description="工具名称")
    order: int = Field(description="执行顺序")
    dependencies: List[int] = Field(default_factory=list, description="依赖的步骤序号")
    input_mapping: Dict[str, str] = Field(default_factory=dict, description="输入参数映射")
    output_mapping: Dict[str, str] = Field(default_factory=dict, description="输出参数映射")
    condition: Optional[str] = Field(None, description="执行条件")


class ToolChain(BaseModel):
    """工具链模型"""
    name: str
    description: str
    steps: List[ToolChainStep]
    estimated_duration: Optional[float] = None
    success_probability: Optional[float] = None
    created_at: datetime = Field(default_factory=datetime.now)
    
    def get_execution_order(self) -> List[int]:
        """获取执行顺序"""
        # 简单的拓扑排序实现
        visited = set()
        order = []
        
        def dfs(step_idx: int):
            if step_idx in visited:
                return
            visited.add(step_idx)
            
            step = self.steps[step_idx]
            for dep in step.dependencies:
                dfs(dep)
            order.append(step_idx)
        
        for i in range(len(self.steps)):
            if i not in visited:
                dfs(i)
        
        return order


class ValidationResult(BaseModel):
    """验证结果模型"""
    is_valid: bool
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    suggestions: List[str] = Field(default_factory=list)
    confidence_score: float = Field(description="置信度分数 (0.0-1.0)")


class AgentAllocation(BaseModel):
    """智能体分配结果模型"""
    allocations: Dict[str, str] = Field(description="智能体ID到任务的分配映射")
    load_balance_score: float = Field(description="负载均衡分数")
    efficiency_score: float = Field(description="效率分数")
    reasoning: str = Field(description="分配理由")


class OutcomePrediction(BaseModel):
    """协作结果预测模型"""
    success_probability: float = Field(description="成功概率")
    estimated_duration: float = Field(description="预估持续时间")
    potential_bottlenecks: List[str] = Field(default_factory=list, description="潜在瓶颈")
    risk_factors: List[str] = Field(default_factory=list, description="风险因素")
    confidence: float = Field(description="预测置信度")