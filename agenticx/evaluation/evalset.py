"""
EvalSet: 标准化评测集格式

借鉴 ADK 的 evalset.json 格式，提供统一的评测集定义。
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Union
from datetime import datetime, timezone
from pathlib import Path
import json
import uuid


class ExpectedToolUse(BaseModel):
    """
    预期的工具调用
    
    定义一个预期的工具调用，包括工具名称、输入参数和匹配模式。
    """
    tool_name: str = Field(description="预期调用的工具名称")
    tool_input: Optional[Dict[str, Any]] = Field(
        default=None, 
        description="预期的工具输入参数（可选，用于精确匹配）"
    )
    match_mode: str = Field(
        default="name_only",
        description="匹配模式: name_only(仅匹配名称), partial(部分匹配参数), exact(完全匹配)"
    )
    
    def matches(self, actual_tool_name: str, actual_input: Optional[Dict[str, Any]] = None) -> bool:
        """
        检查实际调用是否匹配预期
        
        Args:
            actual_tool_name: 实际调用的工具名称
            actual_input: 实际的工具输入参数
            
        Returns:
            是否匹配
        """
        # 名称必须匹配
        if self.tool_name != actual_tool_name:
            return False
        
        # 仅匹配名称
        if self.match_mode == "name_only" or self.tool_input is None:
            return True
        
        # 部分匹配：预期的参数都存在于实际参数中
        if self.match_mode == "partial":
            if actual_input is None:
                return False
            for key, value in self.tool_input.items():
                if key not in actual_input or actual_input[key] != value:
                    return False
            return True
        
        # 完全匹配
        if self.match_mode == "exact":
            return self.tool_input == actual_input
        
        return False


class EvalCase(BaseModel):
    """
    单个评测用例
    
    定义一个完整的评测用例，包括输入、预期输出和元数据。
    """
    id: str = Field(
        default_factory=lambda: str(uuid.uuid4())[:8],
        description="用例唯一标识符"
    )
    name: Optional[str] = Field(default=None, description="用例名称（可选）")
    query: str = Field(description="用户输入/查询")
    
    # 预期的工具调用序列
    expected_tool_use: Optional[List[ExpectedToolUse]] = Field(
        default=None,
        description="预期的工具调用序列"
    )
    
    # 预期的最终响应
    reference: Optional[str] = Field(
        default=None,
        description="预期的最终响应（用于响应质量评估）"
    )
    
    # 评估配置
    trajectory_match_mode: str = Field(
        default="in_order",
        description="轨迹匹配模式: exact(完全匹配), in_order(顺序匹配), any_order(任意顺序)"
    )
    
    # 元数据
    tags: List[str] = Field(default_factory=list, description="用例标签")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="额外元数据")
    
    # 初始上下文（可选）
    initial_context: Optional[Dict[str, Any]] = Field(
        default=None,
        description="初始上下文变量"
    )


class EvalResult(BaseModel):
    """
    单个用例的评测结果
    """
    case_id: str = Field(description="用例 ID")
    case_name: Optional[str] = Field(default=None, description="用例名称")
    
    # 执行信息
    success: bool = Field(description="是否执行成功")
    error: Optional[str] = Field(default=None, description="错误信息")
    
    # 轨迹匹配结果
    trajectory_score: float = Field(
        default=0.0,
        description="轨迹匹配分数 (0.0-1.0)"
    )
    trajectory_matched: bool = Field(
        default=False,
        description="轨迹是否匹配预期"
    )
    
    # 响应评估结果
    response_score: Optional[float] = Field(
        default=None,
        description="响应质量分数 (0.0-1.0)"
    )
    
    # 实际执行数据
    actual_tool_calls: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="实际的工具调用序列"
    )
    actual_response: Optional[str] = Field(
        default=None,
        description="实际的最终响应"
    )
    
    # 性能指标
    execution_time_ms: Optional[float] = Field(
        default=None,
        description="执行时间（毫秒）"
    )
    token_usage: Optional[Dict[str, int]] = Field(
        default=None,
        description="Token 使用量"
    )
    cost: Optional[float] = Field(
        default=None,
        description="执行成本"
    )
    
    # 时间戳
    evaluated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="评测时间"
    )


class EvalSummary(BaseModel):
    """
    评测汇总结果
    """
    total_cases: int = Field(description="总用例数")
    passed_cases: int = Field(description="通过的用例数")
    failed_cases: int = Field(description="失败的用例数")
    error_cases: int = Field(description="执行错误的用例数")
    
    # 分数
    overall_score: float = Field(description="总体分数 (0.0-1.0)")
    trajectory_accuracy: float = Field(description="轨迹匹配准确率")
    response_accuracy: Optional[float] = Field(
        default=None,
        description="响应准确率（如果有 reference）"
    )
    
    # 性能
    avg_execution_time_ms: Optional[float] = Field(
        default=None,
        description="平均执行时间"
    )
    total_tokens: Optional[int] = Field(default=None, description="总 Token 使用量")
    total_cost: Optional[float] = Field(default=None, description="总成本")
    
    # 元数据
    evalset_name: str = Field(description="评测集名称")
    evalset_version: str = Field(description="评测集版本")
    evaluated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="评测时间"
    )
    
    def to_report(self) -> str:
        """生成文本报告"""
        lines = [
            f"═══════════════════════════════════════════",
            f"评测报告: {self.evalset_name} v{self.evalset_version}",
            f"═══════════════════════════════════════════",
            f"",
            f"📊 用例统计:",
            f"  - 总用例数: {self.total_cases}",
            f"  - 通过: {self.passed_cases} ({self.passed_cases/self.total_cases*100:.1f}%)",
            f"  - 失败: {self.failed_cases}",
            f"  - 错误: {self.error_cases}",
            f"",
            f"📈 评分:",
            f"  - 总体分数: {self.overall_score:.2%}",
            f"  - 轨迹准确率: {self.trajectory_accuracy:.2%}",
        ]
        
        if self.response_accuracy is not None:
            lines.append(f"  - 响应准确率: {self.response_accuracy:.2%}")
        
        if self.avg_execution_time_ms is not None:
            lines.append(f"")
            lines.append(f"⚡ 性能:")
            lines.append(f"  - 平均执行时间: {self.avg_execution_time_ms:.0f}ms")
        
        if self.total_tokens is not None:
            lines.append(f"  - 总 Token: {self.total_tokens:,}")
        
        if self.total_cost is not None:
            lines.append(f"  - 总成本: ${self.total_cost:.4f}")
        
        lines.append(f"")
        lines.append(f"🕐 评测时间: {self.evaluated_at.strftime('%Y-%m-%d %H:%M:%S UTC')}")
        lines.append(f"═══════════════════════════════════════════")
        
        return "\n".join(lines)


class EvalSet(BaseModel):
    """
    评测集
    
    包含多个评测用例的集合，支持从 JSON 文件加载和保存。
    格式借鉴 ADK 的 evalset.json。
    """
    name: str = Field(description="评测集名称")
    version: str = Field(default="1.0.0", description="评测集版本")
    description: Optional[str] = Field(default=None, description="评测集描述")
    
    # 用例列表
    cases: List[EvalCase] = Field(default_factory=list, description="评测用例列表")
    
    # 元数据
    metadata: Dict[str, Any] = Field(default_factory=dict, description="额外元数据")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="创建时间"
    )
    
    @classmethod
    def from_file(cls, path: Union[str, Path]) -> "EvalSet":
        """
        从 JSON 文件加载评测集
        
        Args:
            path: JSON 文件路径
            
        Returns:
            EvalSet 实例
        """
        path = Path(path)
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # 兼容 ADK 格式（直接是用例数组）
        if isinstance(data, list):
            # ADK 格式：直接是用例数组
            cases = []
            for i, case_data in enumerate(data):
                # 转换 expected_tool_use 格式
                if "expected_tool_use" in case_data:
                    tool_uses = []
                    for tu in case_data["expected_tool_use"]:
                        tool_uses.append(ExpectedToolUse(
                            tool_name=tu.get("tool_name", tu.get("name", "")),
                            tool_input=tu.get("tool_input", tu.get("input")),
                            match_mode=tu.get("match_mode", "name_only")
                        ))
                    case_data["expected_tool_use"] = tool_uses
                
                cases.append(EvalCase(
                    id=case_data.get("id", str(i)),
                    **{k: v for k, v in case_data.items() if k != "id"}
                ))
            
            return cls(
                name=path.stem,
                cases=cases
            )
        
        # AgenticX 格式
        return cls(**data)
    
    def to_file(self, path: Union[str, Path]) -> None:
        """
        保存评测集到 JSON 文件
        
        Args:
            path: 输出文件路径
        """
        path = Path(path)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(self.model_dump(mode='json'), f, indent=2, ensure_ascii=False, default=str)
    
    def add_case(self, case: EvalCase) -> None:
        """添加评测用例"""
        self.cases.append(case)
    
    def get_case(self, case_id: str) -> Optional[EvalCase]:
        """根据 ID 获取用例"""
        for case in self.cases:
            if case.id == case_id:
                return case
        return None
    
    def filter_by_tags(self, tags: List[str]) -> List[EvalCase]:
        """根据标签筛选用例"""
        return [case for case in self.cases if any(tag in case.tags for tag in tags)]
    
    def __len__(self) -> int:
        return len(self.cases)
    
    def __iter__(self):
        return iter(self.cases)

