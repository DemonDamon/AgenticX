"""
AgenticX M6: 任务契约与成果验证模块

本模块实现了任务输出的解析、验证和自修复功能，确保任务产出符合预定义的契约。
核心理念：将"执行过程"与"成果验收"分离，充当工作流中每个任务节点的"质量守门员"。

主要组件：
- TaskOutputParser: 从 Agent 响应中解析结构化数据
- TaskResultValidator: 对解析结果进行业务规则校验
- OutputRepairLoop: 当解析/校验失败时的自修复机制
"""

import json
import re
from abc import ABC, abstractmethod
from typing import Type, Dict, Any, List, Optional, Union, Callable
from pydantic import BaseModel, ValidationError as PydanticValidationError
from dataclasses import dataclass
from enum import Enum

from .task import Task
from .agent import Agent
from .event import Event, ErrorEvent


class ParseError(Exception):
    """解析错误"""
    pass


class ValidationError(Exception):
    """验证错误"""
    pass


class RepairError(Exception):
    """修复错误"""
    pass


@dataclass
class ParseResult:
    """解析结果"""
    success: bool
    data: Optional[BaseModel] = None
    error: Optional[str] = None
    raw_output: Optional[str] = None
    confidence: float = 0.0


@dataclass
class ValidationResult:
    """验证结果"""
    valid: bool
    errors: List[str]
    warnings: List[str]
    data: Optional[BaseModel] = None


class RepairStrategy(Enum):
    """修复策略"""
    NONE = "none"              # 不修复，直接失败
    SIMPLE = "simple"          # 简单修复（格式调整）
    LLM_GUIDED = "llm_guided"  # LLM 指导修复
    INTERACTIVE = "interactive" # 交互式修复


class TaskOutputParser:
    """
    任务输出解析器
    
    负责从 Agent 的最终响应文本中，依据任务预定义的 Pydantic output_schema，
    解析并实例化出结构化的数据对象。
    """
    
    def __init__(self, 
                 enable_fuzzy_parsing: bool = True,
                 json_extraction_patterns: Optional[List[str]] = None):
        """
        初始化解析器
        
        Args:
            enable_fuzzy_parsing: 是否启用模糊解析
            json_extraction_patterns: JSON 提取的正则表达式模式
        """
        self.enable_fuzzy_parsing = enable_fuzzy_parsing
        self.json_patterns = json_extraction_patterns or [
            r'```json\s*(.*?)\s*```',  # ```json ... ```
            r'```\s*(.*?)\s*```',      # ``` ... ```
            r'\{.*\}',                 # 任何 JSON 对象
            r'\[.*\]'                  # 任何 JSON 数组
        ]
    
    def parse(self, 
              agent_final_response: str, 
              output_schema: Type[BaseModel]) -> ParseResult:
        """
        解析 Agent 的最终响应
        
        Args:
            agent_final_response: Agent 的最终响应文本
            output_schema: 预期的输出 Schema (Pydantic Model)
            
        Returns:
            ParseResult: 解析结果
        """
        try:
            # 1. 尝试直接解析整个响应为 JSON
            result = self._try_direct_json_parse(agent_final_response, output_schema)
            if result.success:
                return result
            
            # 2. 尝试从响应中提取 JSON 片段
            if self.enable_fuzzy_parsing:
                result = self._try_extract_json_fragments(agent_final_response, output_schema)
                if result.success:
                    return result
            
            # 3. 尝试结构化文本解析
            result = self._try_structured_text_parse(agent_final_response, output_schema)
            if result.success:
                return result
                
            # 4. 所有方法都失败
            return ParseResult(
                success=False,
                error=f"无法从响应中解析出符合 {output_schema.__name__} 的结构化数据",
                raw_output=agent_final_response
            )
            
        except Exception as e:
            return ParseResult(
                success=False,
                error=f"解析过程中发生异常: {str(e)}",
                raw_output=agent_final_response
            )
    
    def _try_direct_json_parse(self, response: str, schema: Type[BaseModel]) -> ParseResult:
        """尝试直接将整个响应解析为 JSON"""
        try:
            # 清理响应文本
            cleaned = response.strip()
            if not (cleaned.startswith('{') or cleaned.startswith('[')):
                return ParseResult(success=False, error="响应不是有效的 JSON 格式")
            
            # 解析 JSON
            data = json.loads(cleaned)
            
            # 验证 Schema
            if isinstance(data, dict):
                instance = schema.model_validate(data)
            else:
                instance = schema.model_validate({'__root__': data})
            
            return ParseResult(
                success=True,
                data=instance,
                raw_output=response,
                confidence=1.0
            )
            
        except json.JSONDecodeError as e:
            return ParseResult(success=False, error=f"JSON 解析错误: {str(e)}")
        except PydanticValidationError as e:
            return ParseResult(success=False, error=f"Schema 验证错误: {str(e)}")
        except Exception as e:
            return ParseResult(success=False, error=f"直接解析异常: {str(e)}")
    
    def _try_extract_json_fragments(self, response: str, schema: Type[BaseModel]) -> ParseResult:
        """尝试从响应中提取 JSON 片段"""
        for pattern in self.json_patterns:
            try:
                matches = re.findall(pattern, response, re.DOTALL | re.IGNORECASE)
                
                for match in matches:
                    try:
                        # 清理匹配的文本
                        cleaned = match.strip()
                        
                        # 尝试解析为 JSON
                        data = json.loads(cleaned)
                        
                        # 验证 Schema
                        if isinstance(data, dict):
                            instance = schema.model_validate(data)
                        else:
                            instance = schema.model_validate({'__root__': data})
                        
                        return ParseResult(
                            success=True,
                            data=instance,
                            raw_output=response,
                            confidence=0.8
                        )
                        
                    except (json.JSONDecodeError, PydanticValidationError):
                        continue
                        
            except Exception:
                continue
        
        return ParseResult(success=False, error="未能从响应中提取有效的 JSON 片段")
    
    def _try_structured_text_parse(self, response: str, schema: Type[BaseModel]) -> ParseResult:
        """尝试解析结构化文本"""
        try:
            # 获取 Schema 的字段信息 (兼容 Pydantic V2)
            fields = getattr(schema, 'model_fields', getattr(schema, '__fields__', {}))
            
            # 尝试从文本中提取字段值
            extracted_data = {}
            
            for field_name, field_info in fields.items():
                # 使用多种模式尝试提取字段值
                patterns = [
                    rf"{field_name}\s*[:\-=]\s*([^\n]+)",  # field_name: value
                    rf"**{field_name}**\s*[:\-=]?\s*([^\n]+)",  # **field_name**: value
                    rf"{field_name}:\s*([^\n]+)",  # field_name: value
                ]
                
                for pattern in patterns:
                    match = re.search(pattern, response, re.IGNORECASE | re.MULTILINE)
                    if match:
                        value = match.group(1).strip()
                        
                        # 根据字段类型转换值
                        try:
                            converted_value = self._convert_field_value(value, field_info.annotation)
                            extracted_data[field_name] = converted_value
                            break
                        except Exception:
                            continue
            
            # 如果提取到了一些字段，尝试创建实例
            if extracted_data:
                try:
                    instance = schema.model_validate(extracted_data)
                    return ParseResult(
                        success=True,
                        data=instance,
                        raw_output=response,
                        confidence=0.6
                    )
                except PydanticValidationError as e:
                    return ParseResult(
                        success=False,
                        error=f"结构化文本解析失败: {str(e)}"
                    )
            
            return ParseResult(success=False, error="未能从结构化文本中提取足够的字段")
            
        except Exception as e:
            return ParseResult(success=False, error=f"结构化文本解析异常: {str(e)}")
    
    def _convert_field_value(self, value: str, field_type: Type) -> Any:
        """根据字段类型转换值"""
        # 处理 Pydantic V2 的类型注解
        if hasattr(field_type, '__origin__'):
            # 处理 Optional 类型 (Union[T, None])
            if field_type.__origin__ is Union:
                # 获取非 None 的类型
                non_none_types = [t for t in field_type.__args__ if t is not type(None)]
                if non_none_types:
                    field_type = non_none_types[0]
        
        if field_type == str:
            return value
        elif field_type == int:
            return int(value)
        elif field_type == float:
            return float(value)
        elif field_type == bool:
            return value.lower() in ('true', 'yes', '1', 'on')
        else:
            # 对于复杂类型，尝试 JSON 解析
            try:
                return json.loads(value)
            except:
                return value


class TaskResultValidator:
    """
    任务结果校验器
    
    对 TaskOutputParser 生成的结构化对象进行更深层次的业务规则校验
    （如数值范围、内容合规性等）。
    """
    
    def __init__(self, custom_validators: Optional[Dict[str, Callable]] = None):
        """
        初始化校验器
        
        Args:
            custom_validators: 自定义校验函数字典 {validator_name: validator_func}
        """
        self.custom_validators = custom_validators or {}
        self.built_in_validators = {
            'range': self._validate_range,
            'length': self._validate_length,
            'pattern': self._validate_pattern,
            'enum': self._validate_enum,
            'required': self._validate_required,
            'type': self._validate_type
        }
    
    def validate(self, 
                 parsed_output: BaseModel,
                 validation_rules: Optional[Dict[str, Any]] = None) -> ValidationResult:
        """
        验证解析后的输出
        
        Args:
            parsed_output: 解析后的结构化数据
            validation_rules: 验证规则字典
            
        Returns:
            ValidationResult: 验证结果
        """
        errors = []
        warnings = []
        
        try:
            # 1. Pydantic 内置验证（已在解析阶段完成）
            
            # 2. 自定义业务规则验证
            if validation_rules:
                for field_name, rules in validation_rules.items():
                    field_value = getattr(parsed_output, field_name, None)
                    
                    if isinstance(rules, dict):
                        for rule_name, rule_config in rules.items():
                            result = self._apply_validation_rule(
                                field_name, field_value, rule_name, rule_config
                            )
                            
                            if result['type'] == 'error':
                                errors.append(result['message'])
                            elif result['type'] == 'warning':
                                warnings.append(result['message'])
            
            # 3. 全局数据一致性检查
            consistency_errors = self._check_data_consistency(parsed_output)
            errors.extend(consistency_errors)
            
            return ValidationResult(
                valid=len(errors) == 0,
                errors=errors,
                warnings=warnings,
                data=parsed_output
            )
            
        except Exception as e:
            return ValidationResult(
                valid=False,
                errors=[f"验证过程中发生异常: {str(e)}"],
                warnings=[],
                data=parsed_output
            )
    
    def _apply_validation_rule(self, 
                               field_name: str, 
                               field_value: Any, 
                               rule_name: str, 
                               rule_config: Any) -> Dict[str, str]:
        """应用单个验证规则"""
        try:
            # 尝试内置验证器
            if rule_name in self.built_in_validators:
                validator = self.built_in_validators[rule_name]
                return validator(field_name, field_value, rule_config)
            
            # 尝试自定义验证器
            elif rule_name in self.custom_validators:
                validator = self.custom_validators[rule_name]
                result = validator(field_value, rule_config)
                
                if isinstance(result, bool):
                    return {
                        'type': 'error' if not result else 'success',
                        'message': f"字段 {field_name} 自定义验证失败" if not result else ""
                    }
                elif isinstance(result, dict):
                    return result
                else:
                    return {'type': 'success', 'message': ''}
            
            else:
                return {
                    'type': 'warning',
                    'message': f"未知的验证规则: {rule_name}"
                }
                
        except Exception as e:
            return {
                'type': 'error',
                'message': f"验证规则 {rule_name} 执行失败: {str(e)}"
            }
    
    def _validate_range(self, field_name: str, value: Any, config: Dict) -> Dict[str, str]:
        """验证数值范围"""
        if not isinstance(value, (int, float)):
            return {'type': 'error', 'message': f"字段 {field_name} 不是数值类型"}
        
        min_val = config.get('min')
        max_val = config.get('max')
        
        if min_val is not None and value < min_val:
            return {'type': 'error', 'message': f"字段 {field_name} 值 {value} 小于最小值 {min_val}"}
        
        if max_val is not None and value > max_val:
            return {'type': 'error', 'message': f"字段 {field_name} 值 {value} 大于最大值 {max_val}"}
        
        return {'type': 'success', 'message': ''}
    
    def _validate_length(self, field_name: str, value: Any, config: Dict) -> Dict[str, str]:
        """验证长度"""
        if not hasattr(value, '__len__'):
            return {'type': 'error', 'message': f"字段 {field_name} 不支持长度验证"}
        
        length = len(value)
        min_len = config.get('min')
        max_len = config.get('max')
        
        if min_len is not None and length < min_len:
            return {'type': 'error', 'message': f"字段 {field_name} 长度 {length} 小于最小长度 {min_len}"}
        
        if max_len is not None and length > max_len:
            return {'type': 'error', 'message': f"字段 {field_name} 长度 {length} 大于最大长度 {max_len}"}
        
        return {'type': 'success', 'message': ''}
    
    def _validate_pattern(self, field_name: str, value: Any, config: Dict) -> Dict[str, str]:
        """验证正则表达式模式"""
        if not isinstance(value, str):
            return {'type': 'error', 'message': f"字段 {field_name} 不是字符串类型"}
        
        pattern = config.get('pattern')
        if not pattern:
            return {'type': 'error', 'message': "正则表达式模式未指定"}
        
        if not re.match(pattern, value):
            return {'type': 'error', 'message': f"字段 {field_name} 值不匹配模式 {pattern}"}
        
        return {'type': 'success', 'message': ''}
    
    def _validate_enum(self, field_name: str, value: Any, config: Dict) -> Dict[str, str]:
        """验证枚举值"""
        allowed_values = config.get('values', [])
        if value not in allowed_values:
            return {'type': 'error', 'message': f"字段 {field_name} 值 {value} 不在允许的值列表中: {allowed_values}"}
        
        return {'type': 'success', 'message': ''}
    
    def _validate_required(self, field_name: str, value: Any, config: Dict) -> Dict[str, str]:
        """验证必填字段"""
        if config.get('required', False) and (value is None or value == ""):
            return {'type': 'error', 'message': f"必填字段 {field_name} 不能为空"}
        
        return {'type': 'success', 'message': ''}
    
    def _validate_type(self, field_name: str, value: Any, config: Dict) -> Dict[str, str]:
        """验证类型"""
        expected_type = config.get('type')
        if expected_type and not isinstance(value, expected_type):
            return {'type': 'error', 'message': f"字段 {field_name} 类型错误，期望 {expected_type}，实际 {type(value)}"}
        
        return {'type': 'success', 'message': ''}
    
    def _check_data_consistency(self, data: BaseModel) -> List[str]:
        """检查数据一致性"""
        errors = []
        
        # 这里可以添加跨字段的一致性检查逻辑
        # 例如：开始时间应该早于结束时间等
        
        return errors


class OutputRepairLoop:
    """
    输出自愈循环
    
    当解析或校验失败时，不立即报错，而是启动一个自我修复循环。
    通过 LLM 指导的方式尝试修复输出格式。
    """
    
    def __init__(self, 
                 max_repair_attempts: int = 2,
                 repair_strategy: RepairStrategy = RepairStrategy.LLM_GUIDED):
        """
        初始化修复循环
        
        Args:
            max_repair_attempts: 最大修复尝试次数
            repair_strategy: 修复策略
        """
        self.max_repair_attempts = max_repair_attempts
        self.repair_strategy = repair_strategy
    
    def repair(self,
               original_response: str,
               parse_result: ParseResult,
               validation_result: Optional[ValidationResult],
               expected_schema: Type[BaseModel],
               agent_executor = None) -> ParseResult:
        """
        尝试修复输出
        
        Args:
            original_response: 原始响应
            parse_result: 解析结果
            validation_result: 验证结果
            expected_schema: 期望的 Schema
            agent_executor: Agent 执行器（用于 LLM 指导修复）
            
        Returns:
            ParseResult: 修复后的解析结果
        """
        if self.repair_strategy == RepairStrategy.NONE:
            return parse_result
        
        # 尝试简单修复
        if self.repair_strategy in [RepairStrategy.SIMPLE, RepairStrategy.LLM_GUIDED]:
            simple_repair_result = self._try_simple_repair(
                original_response, parse_result, expected_schema
            )
            if simple_repair_result.success:
                return simple_repair_result
        
        # 尝试 LLM 指导修复
        if self.repair_strategy == RepairStrategy.LLM_GUIDED and agent_executor:
            return self._try_llm_guided_repair(
                original_response, parse_result, validation_result, 
                expected_schema, agent_executor
            )
        
        # 如果所有修复策略都失败，返回原始错误
        return parse_result
    
    def _try_simple_repair(self, 
                           original_response: str,
                           parse_result: ParseResult,
                           expected_schema: Type[BaseModel]) -> ParseResult:
        """尝试简单的格式修复"""
        try:
            # 常见的格式修复策略
            repairs = [
                self._fix_json_quotes,
                self._fix_json_brackets,
                self._fix_json_commas,
                self._extract_json_from_markdown
            ]
            
            for repair_func in repairs:
                try:
                    repaired_text = repair_func(original_response)
                    if repaired_text != original_response:
                        # 尝试重新解析
                        parser = TaskOutputParser()
                        new_result = parser.parse(repaired_text, expected_schema)
                        if new_result.success:
                            return new_result
                except Exception:
                    continue
            
            return ParseResult(
                success=False,
                error="简单修复策略无法修复输出格式",
                raw_output=original_response
            )
            
        except Exception as e:
            return ParseResult(
                success=False,
                error=f"简单修复过程中发生异常: {str(e)}",
                raw_output=original_response
            )
    
    def _try_llm_guided_repair(self,
                               original_response: str,
                               parse_result: ParseResult,
                               validation_result: Optional[ValidationResult],
                               expected_schema: Type[BaseModel],
                               agent_executor) -> ParseResult:
        """尝试 LLM 指导的修复"""
        try:
            from .task import Task
            
            # 构建修复提示
            error_message = parse_result.error or ""
            if validation_result and not validation_result.valid:
                error_message = error_message + f"\n验证错误: {'; '.join(validation_result.errors)}"
            
            schema_description = self._get_schema_description(expected_schema)
            
            repair_prompt = f"""
你的上一次输出格式有误，请根据以下错误进行修正：

错误信息：{error_message}

原始输出：
{original_response}

期望的输出格式：
{schema_description}

请重新生成符合格式要求的输出，确保：
1. 输出是有效的 JSON 格式
2. 包含所有必需的字段
3. 字段类型正确
4. 符合验证规则

修正后的输出：
"""
            
            # 创建修复任务
            repair_task = Task(
                description=repair_prompt,
                expected_output=f"符合 {expected_schema.__name__} 格式的 JSON 输出"
            )
            
            # 执行修复
            for attempt in range(self.max_repair_attempts):
                try:
                    # 这里需要一个简化的执行方式，避免循环依赖
                    # 可以直接调用 LLM，而不是完整的 agent 执行循环
                    
                    # 临时解决方案：返回修复失败
                    # 在实际实现中，这里应该调用 LLM 进行修复
                    break
                    
                except Exception as e:
                    if attempt == self.max_repair_attempts - 1:
                        return ParseResult(
                            success=False,
                            error=f"LLM 修复失败: {str(e)}",
                            raw_output=original_response
                        )
                    continue
            
            return ParseResult(
                success=False,
                error="LLM 修复功能暂未实现",
                raw_output=original_response
            )
            
        except Exception as e:
            return ParseResult(
                success=False,
                error=f"LLM 修复过程中发生异常: {str(e)}",
                raw_output=original_response
            )
    
    def _fix_json_quotes(self, text: str) -> str:
        """修复 JSON 引号问题"""
        # 将单引号替换为双引号
        return text.replace("'", '"')
    
    def _fix_json_brackets(self, text: str) -> str:
        """修复 JSON 括号问题"""
        # 确保 JSON 对象有正确的开始和结束括号
        text = text.strip()
        if text.startswith('{') and not text.endswith('}'):
            text += '}'
        elif not text.startswith('{') and text.endswith('}'):
            text = '{' + text
        return text
    
    def _fix_json_commas(self, text: str) -> str:
        """修复 JSON 逗号问题"""
        # 移除末尾多余的逗号
        return re.sub(r',\s*}', '}', text)
    
    def _extract_json_from_markdown(self, text: str) -> str:
        """从 Markdown 代码块中提取 JSON"""
        match = re.search(r'```(?:json)?\s*(.*?)\s*```', text, re.DOTALL)
        if match:
            return match.group(1).strip()
        return text
    
    def _get_schema_description(self, schema: Type[BaseModel]) -> str:
        """获取 Schema 的描述"""
        try:
            # 生成 JSON Schema 示例 (兼容 Pydantic V2)
            fields = getattr(schema, 'model_fields', getattr(schema, '__fields__', {}))
            example = {}
            for field_name, field_info in fields.items():
                if field_info.type_ == str:
                    example[field_name] = "string_value"
                elif field_info.type_ == int:
                    example[field_name] = 0
                elif field_info.type_ == float:
                    example[field_name] = 0.0
                elif field_info.type_ == bool:
                    example[field_name] = True
                else:
                    example[field_name] = "value"
            
            return json.dumps(example, indent=2, ensure_ascii=False)
            
        except Exception:
            return f"Schema: {schema.__name__}"


# 导出的主要接口
__all__ = [
    'TaskOutputParser',
    'TaskResultValidator', 
    'OutputRepairLoop',
    'ParseResult',
    'ValidationResult',
    'RepairStrategy',
    'ParseError',
    'ValidationError',
    'RepairError'
] 