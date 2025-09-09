"""工具链自动组装器

基于任务需求自动构建和优化工具执行链。
"""

import logging
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime

from ..base import BaseTool
from ...core.task import Task
from .models import (
    TaskFeatures,
    TaskComplexity,
    ToolChain,
    ToolChainStep,
    ValidationResult
)
from .engine import ToolIntelligenceEngine

logger = logging.getLogger(__name__)


class ToolChainAssembler:
    """工具链自动组装器
    
    核心功能：
    1. 分析复杂任务并分解为子任务
    2. 为每个子任务选择合适的工具
    3. 构建工具执行链
    4. 优化工具链性能
    5. 验证工具链的可行性
    """
    
    def __init__(self, intelligence_engine: ToolIntelligenceEngine):
        self.intelligence_engine = intelligence_engine
        self.chain_templates: Dict[str, Dict[str, Any]] = {}
        self.optimization_strategies = [
            self._optimize_parallel_execution,
            self._optimize_data_flow,
            self._optimize_error_handling
        ]
    
    def assemble_tool_chain(self, task: Task, context: Optional[Dict[str, Any]] = None) -> ToolChain:
        """组装工具链
        
        Args:
            task: 要处理的任务
            context: 上下文信息
            
        Returns:
            ToolChain: 组装好的工具链
        """
        context = context or {}
        
        # 分析任务特征
        task_features = self.intelligence_engine.analyze_task(task)
        
        # 检查是否有现成的模板
        template_chain = self._find_template_chain(task_features)
        if template_chain:
            logger.info(f"使用模板构建工具链: {template_chain.name}")
            return self._customize_template_chain(template_chain, task_features, context)
        
        # 分解任务为子任务
        subtasks = self._decompose_task(task, task_features)
        
        # 为每个子任务选择工具
        steps = []
        for i, subtask in enumerate(subtasks):
            tool, confidence, reasoning = self.intelligence_engine.select_optimal_tool(
                subtask['features'], context
            )
            
            step = ToolChainStep(
                tool_name=tool.name,
                order=i,
                dependencies=subtask.get('dependencies', []),
                input_mapping=subtask.get('input_mapping', {}),
                output_mapping=subtask.get('output_mapping', {}),
                condition=subtask.get('condition')
            )
            steps.append(step)
        
        # 创建初始工具链
        chain = ToolChain(
            name=f"auto_chain_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
            description=f"为任务 '{getattr(task, 'description', 'Unknown')}' 自动生成的工具链",
            steps=steps
        )
        
        # 优化工具链
        optimized_chain = self._optimize_chain(chain, task_features)
        
        # 估算执行时间和成功概率
        optimized_chain.estimated_duration = self._estimate_chain_duration(optimized_chain)
        optimized_chain.success_probability = self._estimate_success_probability(optimized_chain)
        
        logger.info(f"成功组装工具链，包含 {len(optimized_chain.steps)} 个步骤")
        return optimized_chain
    
    def validate_tool_chain(self, chain: ToolChain) -> ValidationResult:
        """验证工具链
        
        Args:
            chain: 要验证的工具链
            
        Returns:
            ValidationResult: 验证结果
        """
        errors = []
        warnings = []
        suggestions = []
        
        # 检查步骤依赖关系
        dependency_errors = self._validate_dependencies(chain)
        errors.extend(dependency_errors)
        
        # 检查数据流
        data_flow_warnings = self._validate_data_flow(chain)
        warnings.extend(data_flow_warnings)
        
        # 检查工具兼容性
        compatibility_issues = self._validate_tool_compatibility(chain)
        warnings.extend(compatibility_issues)
        
        # 检查性能瓶颈
        performance_suggestions = self._identify_performance_bottlenecks(chain)
        suggestions.extend(performance_suggestions)
        
        # 计算置信度
        confidence = self._calculate_chain_confidence(chain, len(errors), len(warnings))
        
        return ValidationResult(
            is_valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
            suggestions=suggestions,
            confidence_score=confidence
        )
    
    def register_chain_template(self, name: str, template: List[Dict[str, Any]], 
                              applicable_domains: Optional[List[str]] = None):
        """注册工具链模板
        
        Args:
            name: 模板名称
            template: 模板定义
            applicable_domains: 适用领域列表
        """
        self.chain_templates[name] = {
            'template': template,
            'domains': applicable_domains or [],
            'usage_count': 0,
            'success_rate': 0.0
        }
        logger.info(f"注册工具链模板: {name}")
    
    def optimize_existing_chain(self, chain: ToolChain, performance_data: Optional[Dict[str, Any]] = None) -> ToolChain:
        """优化现有工具链
        
        Args:
            chain: 现有工具链
            performance_data: 性能数据
            
        Returns:
            ToolChain: 优化后的工具链
        """
        performance_data = performance_data or {}
        
        optimized_chain = chain.copy(deep=True)
        
        # 应用优化策略
        for strategy in self.optimization_strategies:
            optimized_chain = strategy(optimized_chain, performance_data)
        
        # 重新估算性能指标
        optimized_chain.estimated_duration = self._estimate_chain_duration(optimized_chain)
        optimized_chain.success_probability = self._estimate_success_probability(optimized_chain)
        
        logger.info(f"工具链优化完成，预估时间: {optimized_chain.estimated_duration:.1f}s")
        return optimized_chain
    
    def _decompose_task(self, task: Task, task_features: TaskFeatures) -> List[Dict[str, Any]]:
        """分解任务为子任务"""
        subtasks = []
        
        if task_features.complexity == TaskComplexity.SIMPLE:
            # 简单任务不需要分解
            subtasks.append({
                'features': task_features,
                'dependencies': [],
                'input_mapping': {},
                'output_mapping': {}
            })
        
        elif task_features.complexity == TaskComplexity.MODERATE:
            # 中等复杂度任务分解为2-3个子任务
            subtasks = self._decompose_moderate_task(task, task_features)
        
        elif task_features.complexity in [TaskComplexity.COMPLEX, TaskComplexity.VERY_COMPLEX]:
            # 复杂任务需要更细致的分解
            subtasks = self._decompose_complex_task(task, task_features)
        
        return subtasks
    
    def _decompose_moderate_task(self, task: Task, task_features: TaskFeatures) -> List[Dict[str, Any]]:
        """分解中等复杂度任务"""
        subtasks = []
        
        # 基于任务领域的分解策略
        if task_features.domain == 'data_analysis':
            subtasks = [
                {
                    'features': TaskFeatures(
                        complexity=TaskComplexity.SIMPLE,
                        domain='data_processing',
                        required_capabilities=['data_loading'],
                        estimated_duration=5.0,
                        priority=1
                    ),
                    'dependencies': [],
                    'output_mapping': {'data': 'loaded_data'}
                },
                {
                    'features': TaskFeatures(
                        complexity=TaskComplexity.SIMPLE,
                        domain='data_analysis',
                        required_capabilities=['data_analysis'],
                        estimated_duration=10.0,
                        priority=1
                    ),
                    'dependencies': [0],
                    'input_mapping': {'data': 'loaded_data'},
                    'output_mapping': {'result': 'analysis_result'}
                }
            ]
        
        elif task_features.domain == 'web_scraping':
            subtasks = [
                {
                    'features': TaskFeatures(
                        complexity=TaskComplexity.SIMPLE,
                        domain='web_scraping',
                        required_capabilities=['web_request'],
                        estimated_duration=15.0,
                        priority=1
                    ),
                    'dependencies': [],
                    'output_mapping': {'html': 'raw_html'}
                },
                {
                    'features': TaskFeatures(
                        complexity=TaskComplexity.SIMPLE,
                        domain='data_processing',
                        required_capabilities=['html_parsing'],
                        estimated_duration=8.0,
                        priority=1
                    ),
                    'dependencies': [0],
                    'input_mapping': {'html': 'raw_html'}
                }
            ]
        
        else:
            # 默认分解策略
            subtasks = [
                {
                    'features': task_features,
                    'dependencies': []
                }
            ]
        
        return subtasks
    
    def _decompose_complex_task(self, task: Task, task_features: TaskFeatures) -> List[Dict[str, Any]]:
        """分解复杂任务"""
        # 复杂任务的分解需要更智能的策略
        # 这里实现一个基础版本，实际应用中可以使用AI规划算法
        
        subtasks = []
        capabilities = task_features.required_capabilities
        
        # 为每个能力创建一个子任务
        for i, capability in enumerate(capabilities):
            subtask_features = TaskFeatures(
                complexity=TaskComplexity.SIMPLE,
                domain=task_features.domain,
                required_capabilities=[capability],
                estimated_duration=5.0,
                priority=1
            )
            
            # 确定依赖关系（简单的线性依赖）
            dependencies = [i-1] if i > 0 else []
            
            subtasks.append({
                'features': subtask_features,
                'dependencies': dependencies,
                'input_mapping': {},
                'output_mapping': {}
            })
        
        return subtasks
    
    def _find_template_chain(self, task_features: TaskFeatures) -> Optional[ToolChain]:
        """查找适用的工具链模板"""
        for name, template_info in self.chain_templates.items():
            if task_features.domain in template_info.get('domains', []):
                # 找到适用的模板
                template = template_info.get('template', [])
                steps = []
                
                for step_def in template:
                    tool = self.intelligence_engine.available_tools.get(step_def['tool_name'])
                    if tool:
                        step = ToolChainStep(
                            tool_name=step_def['tool_name'],
                            order=step_def['order'],
                            dependencies=step_def.get('dependencies', []),
                            input_mapping=step_def.get('input_mapping', {}),
                            output_mapping=step_def.get('output_mapping', {}),
                            condition=None
                        )
                        steps.append(step)
                
                if steps:
                    return ToolChain(
                        name=f"template_{name}",
                        description=f"基于模板 {name} 的工具链",
                        steps=steps
                    )
        
        return None
    
    def _customize_template_chain(self, template_chain: ToolChain, 
                                task_features: TaskFeatures, context: Dict[str, Any]) -> ToolChain:
        """定制模板工具链"""
        # 根据具体任务特征调整模板
        customized_chain = template_chain.copy(deep=True)
        
        # 可以在这里添加定制逻辑
        # 例如：调整参数映射、添加额外步骤等
        
        return customized_chain
    
    def _optimize_chain(self, chain: ToolChain, task_features: TaskFeatures) -> ToolChain:
        """优化工具链"""
        optimized_chain = chain.copy(deep=True)
        
        # 应用所有优化策略
        for strategy in self.optimization_strategies:
            optimized_chain = strategy(optimized_chain)
        
        return optimized_chain
    
    def _optimize_parallel_execution(self, chain: ToolChain, performance_data: Optional[Dict[str, Any]] = None) -> ToolChain:
        """优化并行执行"""
        performance_data = performance_data or {}
        # 识别可以并行执行的步骤
        # 这里实现一个简单版本
        return chain
    
    def _optimize_data_flow(self, chain: ToolChain, performance_data: Optional[Dict[str, Any]] = None) -> ToolChain:
        """优化数据流"""
        performance_data = performance_data or {}
        # 优化步骤间的数据传递
        # 减少不必要的数据转换
        return chain
    
    def _optimize_error_handling(self, chain: ToolChain, performance_data: Optional[Dict[str, Any]] = None) -> ToolChain:
        """优化错误处理"""
        performance_data = performance_data or {}
        # 添加错误处理和重试机制
        return chain
    
    def _estimate_chain_duration(self, chain: ToolChain) -> float:
        """估算工具链执行时间"""
        total_time = 0.0
        
        for step in chain.steps:
            # 获取工具的平均执行时间
            performance = self.intelligence_engine._get_tool_performance(step.tool_name, "general")
            if performance:
                total_time += performance.avg_execution_time
            else:
                total_time += 10.0  # 默认时间
        
        return total_time
    
    def _estimate_success_probability(self, chain: ToolChain) -> float:
        """估算工具链成功概率"""
        if not chain.steps:
            return 0.0
        
        total_probability = 1.0
        
        for step in chain.steps:
            # 获取工具的成功率
            performance = self.intelligence_engine._get_tool_performance(step.tool_name, "general")
            if performance:
                total_probability *= performance.success_rate
            else:
                total_probability *= 0.8  # 默认成功率
        
        return total_probability
    
    def _validate_dependencies(self, chain: ToolChain) -> List[str]:
        """验证依赖关系"""
        errors = []
        
        for step in chain.steps:
            for dep in step.dependencies:
                if dep >= len(chain.steps) or dep < 0:
                    errors.append(f"步骤 {step.order} 的依赖 {dep} 无效")
                elif dep >= step.order:
                    errors.append(f"步骤 {step.order} 不能依赖后续步骤 {dep}")
        
        return errors
    
    def _validate_data_flow(self, chain: ToolChain) -> List[str]:
        """验证数据流"""
        warnings = []
        
        # 检查输入输出映射的一致性
        available_outputs = set()
        
        for step in chain.steps:
            # 检查输入是否可用
            for input_key in step.input_mapping.values():
                if input_key not in available_outputs and step.dependencies:
                    warnings.append(f"步骤 {step.order} 需要的输入 {input_key} 可能不可用")
            
            # 添加此步骤的输出
            available_outputs.update(step.output_mapping.values())
        
        return warnings
    
    def _validate_tool_compatibility(self, chain: ToolChain) -> List[str]:
        """验证工具兼容性"""
        warnings = []
        
        # 检查相邻工具的兼容性
        for i in range(len(chain.steps) - 1):
            current_tool_name = chain.steps[i].tool_name
            next_tool_name = chain.steps[i + 1].tool_name
            
            # 这里可以添加具体的兼容性检查逻辑
            # 例如：检查输出格式是否匹配输入格式
        
        return warnings
    
    def _identify_performance_bottlenecks(self, chain: ToolChain) -> List[str]:
        """识别性能瓶颈"""
        suggestions = []
        
        # 识别执行时间最长的步骤
        max_time = 0.0
        slowest_step = None
        
        for step in chain.steps:
            performance = self.intelligence_engine._get_tool_performance(step.tool_name, "general")
            if performance and performance.avg_execution_time > max_time:
                max_time = performance.avg_execution_time
                slowest_step = step
        
        if slowest_step and max_time > 30.0:  # 超过30秒
            suggestions.append(f"步骤 {slowest_step.order} ({slowest_step.tool_name}) 可能是性能瓶颈")
        
        return suggestions
    
    def _calculate_chain_confidence(self, chain: ToolChain, error_count: int, warning_count: int) -> float:
        """计算工具链置信度"""
        base_confidence = 1.0
        
        # 错误严重影响置信度
        base_confidence -= error_count * 0.3
        
        # 警告轻微影响置信度
        base_confidence -= warning_count * 0.1
        
        # 工具链长度影响置信度
        if len(chain.steps) > 5:
            base_confidence -= (len(chain.steps) - 5) * 0.05
        
        return max(0.0, min(1.0, base_confidence))