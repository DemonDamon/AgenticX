"""后处理工具

主要的后处理工具，协调和管理所有后处理步骤，提供统一的后处理接口。
"""

import logging
import time
from typing import Dict, List, Any, Optional
from agenticx.tools import BaseTool
from agenticx.tools.intelligence.models import ToolResult
from pydantic import BaseModel, Field

from .post_processing_models import (
    ProcessedResult,
    PostProcessingResult,
    PostProcessingConfig,
    ProcessingStatus
)
from .confidence_adjustment_tool import ConfidenceAdjustmentTool
from .result_validation_tool import ResultValidationTool
from .conflict_resolution_tool import ConflictResolutionTool, ConflictResolutionInput
from .entity_optimization_tool import EntityOptimizationTool
from .intent_refinement_tool import IntentRefinementTool


class PostProcessingInput(BaseModel):
    """后处理输入模型"""
    
    results: List[Dict[str, Any]] = Field(description="待处理的识别结果列表")
    text: str = Field(description="原始文本")
    context: Optional[Dict[str, Any]] = Field(default=None, description="上下文信息")
    processing_steps: Optional[List[str]] = Field(default=None, description="处理步骤")
    config: Optional[Dict[str, Any]] = Field(default=None, description="配置参数")


class PostProcessingTool(BaseTool):
    """后处理工具
    
    统一的后处理接口，协调多个后处理子工具：
    - 置信度调整
    - 结果验证
    - 冲突解决
    - 实体优化
    - 意图精化
    
    提供灵活的处理流水线配置和结果整合。
    """
    
    def __init__(self, config: Optional[PostProcessingConfig] = None):
        super().__init__(
            name="post_processing",
            description="对意图识别结果进行全面的后处理，包括验证、优化和精化",
            args_schema=PostProcessingInput
        )
        
        self.config = config or PostProcessingConfig()
        self.logger = logging.getLogger(__name__)
        
        # 初始化子工具
        self._initialize_sub_tools()
        
        # 默认处理步骤
        self._default_processing_steps = [
            "conflict_resolution",
            "entity_optimization", 
            "intent_refinement",
            "confidence_adjustment",
            "result_validation"
        ]
        
        # 处理步骤配置
        self._step_configs = self._initialize_step_configs()
    
    def _initialize_sub_tools(self):
        """初始化子工具"""
        try:
            self.confidence_adjustment_tool = ConfidenceAdjustmentTool(self.config)
            self.result_validation_tool = ResultValidationTool(self.config)
            self.conflict_resolution_tool = ConflictResolutionTool(self.config)
            self.entity_optimization_tool = EntityOptimizationTool(self.config)
            self.intent_refinement_tool = IntentRefinementTool(self.config)
            
            self.logger.info("后处理子工具初始化完成")
        except Exception as e:
            self.logger.error(f"子工具初始化失败: {str(e)}")
            raise
    
    def _initialize_step_configs(self) -> Dict[str, Dict[str, Any]]:
        """初始化处理步骤配置"""
        return {
            "conflict_resolution": {
                "enabled": True,
                "required_min_results": 2,
                "strategy": "hybrid",
                "priority_weights": {
                    "llm_result": 0.4,
                    "rule_result": 0.3,
                    "hybrid_result": 0.3
                }
            },
            "entity_optimization": {
                "enabled": True,
                "optimization_rules": [
                    "deduplication",
                    "boundary_optimization",
                    "type_standardization",
                    "value_cleaning",
                    "overlap_resolution"
                ]
            },
            "intent_refinement": {
                "enabled": True,
                "refinement_rules": [
                    "entity_validation",
                    "context_analysis",
                    "confidence_recalculation",
                    "hierarchy_inference",
                    "ambiguity_resolution"
                ]
            },
            "confidence_adjustment": {
                "enabled": True,
                "adjustment_factors": {
                    "entity_consistency": 0.3,
                    "context_relevance": 0.25,
                    "historical_accuracy": 0.25,
                    "confidence_range": 0.2
                }
            },
            "result_validation": {
                "enabled": True,
                "validation_level": "strict",
                "validation_rules": [
                    "intent_entity_consistency",
                    "confidence_threshold",
                    "entity_format_validation",
                    "context_relevance",
                    "business_rules"
                ]
            }
        }
    
    def _run(self, **kwargs) -> ToolResult:
        """BaseTool要求的抽象方法实现"""
        return self.execute(**kwargs)
    
    def execute(self, **kwargs) -> ToolResult:
        """执行后处理"""
        try:
            start_time = time.time()
            
            # 解析输入参数
            input_data = PostProcessingInput(**kwargs)
            
            # 执行后处理流水线
            processed_result = self._execute_processing_pipeline(
                results=input_data.results,
                text=input_data.text,
                context=input_data.context or {},
                processing_steps=input_data.processing_steps or self._default_processing_steps,
                config=input_data.config or {}
            )
            
            processing_time = time.time() - start_time
            
            # 记录日志
            if self.config.enable_logging:
                self.logger.info(
                    f"后处理完成: 输入{len(input_data.results)}个结果, "
                    f"输出{len(processed_result.final_results)}个结果 "
                    f"(耗时: {processing_time:.3f}s)"
                )
            
            return ToolResult(
                tool_name="post_processing",
                success=True,
                execution_time=processing_time,
                result_data={
                    "data": processed_result.dict(),
                    "metadata": {
                        "processing_time": processing_time
                    }
                },
                error_message=None
            )
            
        except Exception as e:
            self.logger.error(f"后处理失败: {str(e)}")
            return ToolResult(
                tool_name="post_processing",
                success=False,
                execution_time=0.0,
                result_data=None,
                error_message=f"后处理失败: {str(e)}"
            )
    
    def _execute_processing_pipeline(
        self,
        results: List[Dict[str, Any]],
        text: str,
        context: Dict[str, Any],
        processing_steps: List[str],
        config: Dict[str, Any]
    ) -> PostProcessingResult:
        """执行处理流水线"""
        
        # 初始化处理结果
        current_results = results.copy()
        processing_history = []
        
        # 记录原始输入
        processing_history.append({
            "step": "input",
            "timestamp": time.time(),
            "results_count": len(current_results),
            "details": "原始输入结果"
        })
        
        # 逐步执行处理步骤
        for step in processing_steps:
            if not self._step_configs.get(step, {}).get("enabled", True):
                self.logger.info(f"跳过已禁用的处理步骤: {step}")
                continue
            
            try:
                step_start_time = time.time()
                
                # 执行具体的处理步骤
                step_result = self._execute_processing_step(
                    step, current_results, text, context, config
                )
                
                step_processing_time = time.time() - step_start_time
                
                # 更新当前结果
                if step_result and step_result.get("success", False):
                    if step == "conflict_resolution":
                        # 冲突解决返回单一最终结果
                        final_result = step_result.get("data", {}).get("final_result")
                        if final_result:
                            current_results = [final_result]
                    elif step in ["entity_optimization", "intent_refinement", "confidence_adjustment"]:
                        # 这些步骤修改现有结果
                        if len(current_results) > 0:
                            optimized_data = step_result.get("data", {})
                            if step == "entity_optimization":
                                current_results[0]["entities"] = optimized_data.get("optimized_entities", current_results[0].get("entities", []))
                            elif step == "intent_refinement":
                                current_results[0]["intent"] = optimized_data.get("refined_intent", current_results[0].get("intent"))
                                current_results[0]["confidence"] = optimized_data.get("refined_confidence", current_results[0].get("confidence", 0.0))
                            elif step == "confidence_adjustment":
                                current_results[0]["confidence"] = optimized_data.get("adjusted_confidence", current_results[0].get("confidence", 0.0))
                    
                    # 记录处理历史
                    processing_history.append({
                        "step": step,
                        "timestamp": time.time(),
                        "processing_time": step_processing_time,
                        "results_count": len(current_results),
                        "success": True,
                        "details": step_result.get("summary", f"{step}处理完成")
                    })
                    
                    self.logger.info(f"处理步骤{step}完成 (耗时: {step_processing_time:.3f}s)")
                else:
                    # 处理失败，记录错误但继续
                    error_msg = step_result.get("error", f"{step}处理失败") if step_result else f"{step}处理返回空结果"
                    
                    processing_history.append({
                        "step": step,
                        "timestamp": time.time(),
                        "processing_time": step_processing_time,
                        "results_count": len(current_results),
                        "success": False,
                        "error": error_msg
                    })
                    
                    self.logger.warning(f"处理步骤{step}失败: {error_msg}")
                    
            except Exception as e:
                # 步骤执行异常，记录错误但继续
                error_msg = f"{step}执行异常: {str(e)}"
                
                processing_history.append({
                    "step": step,
                    "timestamp": time.time(),
                    "processing_time": 0.0,
                    "results_count": len(current_results),
                    "success": False,
                    "error": error_msg
                })
                
                self.logger.error(error_msg)
        
        # 最终验证（如果启用）
        final_validation_result = None
        if "result_validation" in processing_steps:
            try:
                final_validation_result = self._execute_final_validation(
                    current_results, text, context
                )
            except Exception as e:
                self.logger.warning(f"最终验证失败: {str(e)}")
        
        # 计算处理统计
        successful_steps = sum(1 for h in processing_history if h.get("success", False))
        total_steps = len([h for h in processing_history if h.get("step") != "input"])
        success_rate = successful_steps / total_steps if total_steps > 0 else 0.0
        
        # 计算质量分数
        quality_score = self._calculate_quality_score(current_results, processing_history)
        
        return PostProcessingResult(
            original_results=results,
            final_results=current_results,
            processing_steps=processing_steps,
            processing_history=processing_history,
            success_rate=success_rate,
            quality_score=quality_score,
            validation_result=final_validation_result,
            metadata={
                "total_processing_steps": total_steps,
                "successful_steps": successful_steps,
                "text_length": len(text),
                "context_keys": list(context.keys()),
                "timestamp": time.time()
            }
        )
    
    def _execute_processing_step(
        self, step: str, results: List[Dict[str, Any]], text: str, 
        context: Dict[str, Any], config: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """执行具体的处理步骤"""
        
        step_config = self._step_configs.get(step, {})
        
        try:
            if step == "conflict_resolution":
                # 冲突解决需要多个结果
                if len(results) < step_config.get("required_min_results", 2):
                    return {
                        "success": True,
                        "data": {"final_result": results[0] if results else {}},
                        "summary": "结果数量不足，跳过冲突解决"
                    }
                
                input_data = ConflictResolutionInput(
                    results=results,
                    resolution_strategy=step_config.get("strategy", "hybrid"),
                    priority_weights=step_config.get("priority_weights", {}),
                    config=config
                )
                
                tool_result = self.conflict_resolution_tool.execute(input_data)
                
                if tool_result.error_message:
                    return {"success": False, "error": tool_result.error_message}
                
                result_data = tool_result.result_data.get("data", {})
                return {
                    "success": True,
                    "data": result_data,
                    "summary": f"冲突解决完成，解决了{result_data.get('resolved_count', 0)}个冲突"
                }
            
            elif step == "entity_optimization":
                if not results:
                    return {"success": True, "data": {}, "summary": "无结果需要实体优化"}
                
                entities = results[0].get("entities", [])
                
                from .entity_optimization_tool import EntityOptimizationInput
                input_data = EntityOptimizationInput(
                    entities=entities,
                    text=text,
                    optimization_rules=step_config.get("optimization_rules", []),
                    config=config
                )
                
                tool_result = self.entity_optimization_tool.execute(input_data)
                
                if tool_result.error_message:
                    return {"success": False, "error": tool_result.error_message}
                
                return {
                    "success": True,
                    "data": tool_result.result_data.get('data', {}),
                    "summary": f"实体优化完成，优化了{tool_result.result_data.get('data', {}).get('optimized_count', 0)}个实体"
                }
            
            elif step == "intent_refinement":
                if not results:
                    return {"success": True, "data": {}, "summary": "无结果需要意图精化"}
                
                result = results[0]
                
                from .intent_refinement_tool import IntentRefinementInput
                input_data = IntentRefinementInput(
                    intent=result.get("intent", ""),
                    confidence=result.get("confidence", 0.0),
                    entities=result.get("entities", []),
                    text=text,
                    context=context,
                    refinement_rules=step_config.get("refinement_rules", []),
                    config=config
                )
                
                tool_result = self.intent_refinement_tool.execute(input_data)
                
                if tool_result.error_message:
                    return {"success": False, "error": tool_result.error_message}
                
                return {
                    "success": True,
                    "data": tool_result.result_data.get('data', {}),
                    "summary": f"意图精化完成，改进分数: {tool_result.result_data.get('data', {}).get('improvement_score', 0.0):.3f}"
                }
            
            elif step == "confidence_adjustment":
                if not results:
                    return {"success": True, "data": {}, "summary": "无结果需要置信度调整"}
                
                result = results[0]
                
                from .confidence_adjustment_tool import ConfidenceAdjustmentInput
                input_data = ConfidenceAdjustmentInput(
                    intent=result.get("intent", ""),
                    entities=result.get("entities", []),
                    original_confidence=result.get("confidence", 0.0),
                    context=context,
                    config=config
                )
                
                tool_result = self.confidence_adjustment_tool.execute(input_data)
                
                if tool_result.error_message:
                    return {"success": False, "error": tool_result.error_message}
                
                return {
                    "success": True,
                    "data": tool_result.result_data.get('data', {}),
                    "summary": f"置信度调整完成，调整幅度: {tool_result.result_data.get('data', {}).get('adjustment_magnitude', 0.0):.3f}"
                }
            
            elif step == "result_validation":
                if not results:
                    return {"success": True, "data": {}, "summary": "无结果需要验证"}
                
                result = results[0]
                
                from .result_validation_tool import ResultValidationInput
                input_data = ResultValidationInput(
                    intent=result.get("intent", ""),
                    entities=result.get("entities", []),
                    confidence=result.get("confidence", 0.0),
                    context=context,
                    validation_level=step_config.get("validation_level", "moderate"),
                    config=config
                )
                
                tool_result = self.result_validation_tool.execute(input_data)
                
                if tool_result.error_message:
                    return {"success": False, "error": tool_result.error_message}
                
                return {
                    "success": True,
                    "data": tool_result.result_data.get('data', {}),
                    "summary": f"结果验证完成，验证分数: {tool_result.result_data.get('data', {}).get('validation_score', 0.0):.3f}"
                }
            
            else:
                return {"success": False, "error": f"未知的处理步骤: {step}"}
                
        except Exception as e:
            return {"success": False, "error": f"{step}执行异常: {str(e)}"}
    
    def _execute_final_validation(
        self, results: List[Dict[str, Any]], text: str, context: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """执行最终验证"""
        
        if not results:
            return None
        
        result = results[0]
        
        from .result_validation_tool import ResultValidationInput
        input_data = ResultValidationInput(
            intent=result.get("intent", ""),
            entities=result.get("entities", []),
            confidence=result.get("confidence", 0.0),
            context=context,
            validation_level="strict",
            config={}
        )
        
        tool_result = self.result_validation_tool.execute(input_data)
        
        if tool_result.error_message:
            return {"success": False, "error": tool_result.error_message}
        
        return {"success": True, "data": tool_result.result_data.get('data', {})}
    
    def _calculate_quality_score(self, results: List[Dict[str, Any]], processing_history: List[Dict[str, Any]]) -> float:
        """计算质量分数"""
        
        if not results:
            return 0.0
        
        result = results[0]
        
        # 基础分数（置信度）
        base_score = result.get("confidence", 0.0)
        
        # 处理成功率加分
        successful_steps = sum(1 for h in processing_history if h.get("success", False))
        total_steps = len([h for h in processing_history if h.get("step") != "input"])
        success_rate = successful_steps / total_steps if total_steps > 0 else 1.0
        
        # 实体质量加分
        entities = result.get("entities", [])
        entity_score = 0.0
        if entities:
            # 计算实体的平均置信度
            entity_confidences = [e.get("confidence", 0.0) for e in entities if e.get("confidence")]
            if entity_confidences:
                entity_score = sum(entity_confidences) / len(entity_confidences)
        
        # 综合质量分数
        quality_score = (
            base_score * 0.5 +
            success_rate * 0.3 +
            entity_score * 0.2
        )
        
        return min(1.0, max(0.0, quality_score))
    
    def get_processing_statistics(self) -> Dict[str, Any]:
        """获取处理统计信息"""
        return {
            "default_processing_steps": self._default_processing_steps,
            "step_configs": self._step_configs,
            "sub_tools": {
                "confidence_adjustment": self.confidence_adjustment_tool.get_adjustment_statistics(),
                "result_validation": self.result_validation_tool.get_validation_statistics(),
                "conflict_resolution": self.conflict_resolution_tool.get_conflict_statistics(),
                "entity_optimization": self.entity_optimization_tool.get_optimization_statistics(),
                "intent_refinement": self.intent_refinement_tool.get_refinement_statistics()
            },
            "config": self.config.to_dict()
        }
    
    def configure_processing_steps(self, steps_config: Dict[str, Dict[str, Any]]):
        """配置处理步骤"""
        for step, config in steps_config.items():
            if step in self._step_configs:
                self._step_configs[step].update(config)
                self.logger.info(f"更新处理步骤配置: {step}")
            else:
                self.logger.warning(f"未知的处理步骤: {step}")
    
    def set_default_processing_steps(self, steps: List[str]):
        """设置默认处理步骤"""
        valid_steps = []
        for step in steps:
            if step in self._step_configs:
                valid_steps.append(step)
            else:
                self.logger.warning(f"无效的处理步骤: {step}")
        
        if valid_steps:
            self._default_processing_steps = valid_steps
            self.logger.info(f"更新默认处理步骤: {valid_steps}")
        else:
            self.logger.error("没有有效的处理步骤")