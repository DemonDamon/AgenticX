"""工具智能选择引擎

基于任务特征、历史性能和上下文信息智能选择最优工具。
"""

import logging
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timedelta, UTC

from ..base import BaseTool
from ...core.task import Task
from .models import (
    TaskFeatures, 
    TaskComplexity, 
    PerformanceMetrics, 
    ToolResult,
    ValidationResult
)
from .history import ToolUsageHistory

logger = logging.getLogger(__name__)


class ToolIntelligenceEngine:
    """工具智能选择引擎
    
    核心功能：
    1. 基于任务特征智能选择工具
    2. 学习历史使用模式
    3. 动态调整选择策略
    4. 提供选择理由和置信度
    """
    
    def __init__(self, usage_history: Optional[ToolUsageHistory] = None):
        self.usage_history = usage_history or ToolUsageHistory()
        self.available_tools: Dict[str, BaseTool] = {}
        self.performance_cache: Dict[str, PerformanceMetrics] = {}
        self.domain_expertise: Dict[str, List[str]] = {}  # 领域 -> 工具列表
        self.capability_mapping: Dict[str, List[str]] = {}  # 能力 -> 工具列表
        
    def register_tool(self, tool: BaseTool, domains: Optional[List[str]] = None, capabilities: Optional[List[str]] = None):
        """注册工具到智能引擎
        
        Args:
            tool: 要注册的工具
            domains: 工具适用的领域列表
            capabilities: 工具提供的能力列表
        """
        domains = domains or []
        capabilities = capabilities or []
        self.available_tools[tool.name] = tool
        
        # 更新领域专长映射
        if domains:
            for domain in domains:
                if domain not in self.domain_expertise:
                    self.domain_expertise[domain] = []
                if tool.name not in self.domain_expertise[domain]:
                    self.domain_expertise[domain].append(tool.name)
        
        # 更新能力映射
        if capabilities:
            for capability in capabilities:
                if capability not in self.capability_mapping:
                    self.capability_mapping[capability] = []
                if tool.name not in self.capability_mapping[capability]:
                    self.capability_mapping[capability].append(tool.name)
        
        logger.info(f"工具 {tool.name} 已注册到智能引擎")
    
    def analyze_task(self, task: Task) -> TaskFeatures:
        """分析任务特征
        
        Args:
            task: 要分析的任务
            
        Returns:
            TaskFeatures: 任务特征
        """
        # 基于任务描述和要求分析复杂度
        complexity = self._estimate_complexity(task)
        
        # 提取所需能力
        required_capabilities = self._extract_capabilities(task)
        
        # 识别任务领域
        domain = self._identify_domain(task)
        
        # 估算执行时间
        estimated_duration = self._estimate_duration(task, complexity)
        
        return TaskFeatures(
            complexity=complexity,
            domain=domain,
            required_capabilities=required_capabilities,
            estimated_duration=estimated_duration,
            priority=getattr(task, 'priority', 1),
            resource_requirements=getattr(task, 'resource_requirements', {})
        )
    
    def select_optimal_tool(self, task_features: TaskFeatures, context: Optional[Dict[str, Any]] = None) -> Tuple[BaseTool, float, str]:
        """选择最优工具
        
        Args:
            task_features: 任务特征
            context: 上下文信息
            
        Returns:
            Tuple[BaseTool, float, str]: (选中的工具, 置信度, 选择理由)
        """
        context = context or {}
        
        # 获取候选工具
        candidates = self._get_candidate_tools(task_features)
        
        if not candidates:
            raise ValueError(f"没有找到适合领域 {task_features.domain} 的工具")
        
        # 计算每个候选工具的得分
        scored_tools = []
        for tool_name in candidates:
            tool = self.available_tools[tool_name]
            score, reasoning = self._calculate_tool_score(tool, task_features, context)
            scored_tools.append((tool, score, reasoning))
        
        # 按得分排序，选择最高分的工具
        scored_tools.sort(key=lambda x: x[1], reverse=True)
        best_tool, best_score, reasoning = scored_tools[0]
        
        logger.info(f"为任务选择工具 {best_tool.name}，得分: {best_score:.3f}")
        
        return best_tool, best_score, reasoning
    
    def validate_tool_selection(self, tool: BaseTool, task_features: TaskFeatures) -> ValidationResult:
        """验证工具选择的合理性
        
        Args:
            tool: 选择的工具
            task_features: 任务特征
            
        Returns:
            ValidationResult: 验证结果
        """
        errors = []
        warnings = []
        suggestions = []
        
        # 检查工具是否支持所需能力
        tool_capabilities = self._get_tool_capabilities(tool)
        missing_capabilities = set(task_features.required_capabilities) - set(tool_capabilities)
        if missing_capabilities:
            errors.append(f"工具 {tool.name} 缺少必需能力: {', '.join(missing_capabilities)}")
        
        # 检查历史性能
        performance = self._get_tool_performance(tool.name, task_features.domain)
        if performance and performance.success_rate < 0.7:
            warnings.append(f"工具 {tool.name} 在 {task_features.domain} 领域成功率较低: {performance.success_rate:.2f}")
        
        # 检查资源需求
        if task_features.resource_requirements:
            resource_warnings = self._check_resource_compatibility(tool, task_features.resource_requirements)
            warnings.extend(resource_warnings)
        
        # 提供改进建议
        if task_features.complexity == TaskComplexity.COMPLEX:
            suggestions.append("考虑使用工具链来处理复杂任务")
        
        # 计算置信度
        confidence = self._calculate_confidence(len(errors), len(warnings), performance)
        
        return ValidationResult(
            is_valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
            suggestions=suggestions,
            confidence_score=confidence
        )
    
    def learn_from_execution(self, tool_result: ToolResult, task_features: TaskFeatures):
        """从执行结果中学习
        
        Args:
            tool_result: 工具执行结果
            task_features: 任务特征
        """
        # 更新使用历史
        self.usage_history.record_usage(
            tool_name=tool_result.tool_name,
            task_domain=task_features.domain,
            success=tool_result.success,
            execution_time=tool_result.execution_time,
            context={
                'complexity': task_features.complexity.value,
                'capabilities': task_features.required_capabilities
            }
        )
        
        # 更新性能缓存
        self._update_performance_cache(tool_result, task_features)
        
        logger.info(f"从工具 {tool_result.tool_name} 的执行结果中学习完成")
    
    def _estimate_complexity(self, task: Task) -> TaskComplexity:
        """估算任务复杂度"""
        description = getattr(task, 'description', '')
        requirements = getattr(task, 'requirements', [])
        
        # 简单的启发式规则
        if len(requirements) <= 1 and len(description.split()) < 20:
            return TaskComplexity.SIMPLE
        elif len(requirements) <= 3 and len(description.split()) < 50:
            return TaskComplexity.MODERATE
        elif len(requirements) <= 5 and len(description.split()) < 100:
            return TaskComplexity.COMPLEX
        else:
            return TaskComplexity.VERY_COMPLEX
    
    def _extract_capabilities(self, task: Task) -> List[str]:
        """提取任务所需能力"""
        # 这里可以使用NLP技术从任务描述中提取能力
        # 暂时使用简单的关键词匹配
        description = getattr(task, 'description', '').lower()
        capabilities = []
        
        capability_keywords = {
            'data_processing': ['数据', '处理', '分析', 'data', 'process'],
            'web_scraping': ['爬虫', '抓取', '网页', 'scrape', 'crawl'],
            'file_operations': ['文件', '读取', '写入', 'file', 'read', 'write'],
            'api_calls': ['api', '接口', '调用', 'request'],
            'text_processing': ['文本', '处理', '分析', 'text', 'nlp']
        }
        
        for capability, keywords in capability_keywords.items():
            if any(keyword in description for keyword in keywords):
                capabilities.append(capability)
        
        return capabilities
    
    def _identify_domain(self, task: Task) -> str:
        """识别任务领域"""
        description = getattr(task, 'description', '').lower()
        
        domain_keywords = {
            'data_analysis': ['数据分析', '统计', '图表', 'analysis', 'statistics'],
            'web_scraping': ['网页抓取', '爬虫', 'scraping', 'crawling'],
            'automation': ['自动化', '批处理', 'automation', 'batch'],
            'integration': ['集成', '连接', 'integration', 'connect'],
            'monitoring': ['监控', '检测', 'monitoring', 'detection']
        }
        
        for domain, keywords in domain_keywords.items():
            if any(keyword in description for keyword in keywords):
                return domain
        
        return 'general'  # 默认领域
    
    def _estimate_duration(self, task: Task, complexity: TaskComplexity) -> float:
        """估算执行时间"""
        base_times = {
            TaskComplexity.SIMPLE: 5.0,
            TaskComplexity.MODERATE: 15.0,
            TaskComplexity.COMPLEX: 45.0,
            TaskComplexity.VERY_COMPLEX: 120.0
        }
        return base_times.get(complexity, 30.0)
    
    def _get_candidate_tools(self, task_features: TaskFeatures) -> List[str]:
        """获取候选工具列表"""
        candidates = set()
        
        # 基于领域获取候选工具
        if task_features.domain in self.domain_expertise:
            candidates.update(self.domain_expertise[task_features.domain])
        
        # 基于能力获取候选工具
        for capability in task_features.required_capabilities:
            if capability in self.capability_mapping:
                candidates.update(self.capability_mapping[capability])
        
        # 如果没有找到候选工具，返回所有可用工具
        if not candidates:
            candidates = set(self.available_tools.keys())
        
        return list(candidates)
    
    def _calculate_tool_score(self, tool: BaseTool, task_features: TaskFeatures, context: Dict[str, Any]) -> Tuple[float, str]:
        """计算工具得分"""
        score = 0.0
        reasoning_parts = []
        
        # 历史性能得分 (40%)
        performance = self._get_tool_performance(tool.name, task_features.domain)
        if performance:
            perf_score = performance.success_rate * 0.4
            score += perf_score
            reasoning_parts.append(f"历史成功率: {performance.success_rate:.2f}")
        else:
            score += 0.2  # 默认分数
            reasoning_parts.append("无历史数据，使用默认分数")
        
        # 能力匹配得分 (30%)
        tool_capabilities = self._get_tool_capabilities(tool)
        matched_capabilities = set(task_features.required_capabilities) & set(tool_capabilities)
        if task_features.required_capabilities:
            capability_score = len(matched_capabilities) / len(task_features.required_capabilities) * 0.3
            score += capability_score
            reasoning_parts.append(f"能力匹配: {len(matched_capabilities)}/{len(task_features.required_capabilities)}")
        
        # 执行时间得分 (20%)
        if performance and performance.avg_execution_time > 0:
            # 执行时间越短得分越高
            time_score = min(0.2, 30.0 / performance.avg_execution_time * 0.2)
            score += time_score
            reasoning_parts.append(f"平均执行时间: {performance.avg_execution_time:.1f}s")
        
        # 上下文相关性得分 (10%)
        context_score = self._calculate_context_score(tool, context) * 0.1
        score += context_score
        
        reasoning = "; ".join(reasoning_parts)
        return score, reasoning
    
    def _get_tool_capabilities(self, tool: BaseTool) -> List[str]:
        """获取工具能力列表"""
        # 从工具的能力映射中反向查找
        capabilities = []
        for capability, tools in self.capability_mapping.items():
            if tool.name in tools:
                capabilities.append(capability)
        return capabilities
    
    def _get_tool_performance(self, tool_name: str, domain: str) -> Optional[PerformanceMetrics]:
        """获取工具在特定领域的性能指标"""
        cache_key = f"{tool_name}_{domain}"
        if cache_key in self.performance_cache:
            return self.performance_cache[cache_key]
        
        # 从使用历史中计算性能指标
        history_data = self.usage_history.get_tool_history(tool_name, domain)
        if not history_data:
            return None
        
        total_executions = len(history_data)
        successful_executions = sum(1 for record in history_data if record.get('success', False))
        total_time = sum(record.get('execution_time', 0) for record in history_data)
        
        performance = PerformanceMetrics(
            tool_name=tool_name,
            success_rate=successful_executions / total_executions if total_executions > 0 else 0.0,
            avg_execution_time=total_time / total_executions if total_executions > 0 else 0.0,
            total_executions=total_executions,
            error_rate=1.0 - (successful_executions / total_executions) if total_executions > 0 else 0.0
        )
        
        # 缓存结果
        self.performance_cache[cache_key] = performance
        return performance
    
    def _check_resource_compatibility(self, tool: BaseTool, requirements: Dict[str, Any]) -> List[str]:
        """检查资源兼容性"""
        warnings = []
        
        # 检查内存需求
        if 'memory' in requirements:
            required_memory = requirements['memory']
            if required_memory > 1024:  # 1GB
                warnings.append(f"任务需要大量内存 ({required_memory}MB)，请确保工具支持")
        
        # 检查网络需求
        if requirements.get('network_access', False):
            if not getattr(tool, 'supports_network', True):
                warnings.append("任务需要网络访问，但工具可能不支持")
        
        return warnings
    
    def _calculate_confidence(self, error_count: int, warning_count: int, performance: Optional[PerformanceMetrics]) -> float:
        """计算置信度"""
        base_confidence = 1.0
        
        # 错误降低置信度
        base_confidence -= error_count * 0.3
        
        # 警告降低置信度
        base_confidence -= warning_count * 0.1
        
        # 历史性能影响置信度
        if performance:
            base_confidence *= performance.success_rate
        
        return max(0.0, min(1.0, base_confidence))
    
    def _update_performance_cache(self, tool_result: ToolResult, task_features: TaskFeatures):
        """更新性能缓存"""
        cache_key = f"{tool_result.tool_name}_{task_features.domain}"
        
        # 清除缓存，强制重新计算
        if cache_key in self.performance_cache:
            del self.performance_cache[cache_key]
    
    def _calculate_context_score(self, tool: BaseTool, context: Dict[str, Any]) -> float:
        """计算上下文相关性得分"""
        # 简单的上下文评分逻辑
        score = 0.5  # 基础分数
        
        # 如果上下文中有优先工具列表
        if 'preferred_tools' in context:
            preferred_tools = context['preferred_tools']
            if tool.name in preferred_tools:
                score += 0.3
        
        # 如果上下文中有排除工具列表
        if 'excluded_tools' in context:
            excluded_tools = context['excluded_tools']
            if tool.name in excluded_tools:
                score -= 0.5
        
        return max(0.0, min(1.0, score))