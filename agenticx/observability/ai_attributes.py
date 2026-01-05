"""
OpenTelemetry Semantic Conventions for GenAI

本模块定义了与 OpenTelemetry AI SIG 规范对齐的属性常量，
用于 AI 操作的可观测性指标命名。

参考文档:
- OpenTelemetry Semantic Conventions for GenAI: https://opentelemetry.io/docs/specs/semconv/gen-ai/
- Spring AI AiObservationAttributes: spring-ai-model/.../observation/AiObservationAttributes.java

版本: 1.0.0
内化来源: Spring AI ChatModelObservationDocumentation
"""

from enum import Enum
from typing import Dict, Any


class AiOperationType(Enum):
    """AI 操作类型枚举"""
    CHAT = "chat"
    EMBEDDING = "embedding"
    TEXT_COMPLETION = "text_completion"
    IMAGE_GENERATION = "image_generation"
    AUDIO_TRANSCRIPTION = "audio_transcription"
    AUDIO_SPEECH = "audio_speech"
    TOOL_CALL = "tool_call"


class AiObservationAttributes:
    """
    AI 操作的标准属性名称（遵循 OpenTelemetry AI SIG 规范）
    
    这些属性名称与 OpenTelemetry Semantic Conventions for GenAI 保持一致，
    确保与 Grafana、Datadog、Jaeger 等可观测性平台的开箱即用兼容性。
    
    属性分类:
    - 操作元数据: 描述 AI 操作的基本信息
    - 请求属性: LLM 请求参数
    - 响应属性: LLM 响应信息
    - Token 用量: Token 消耗统计
    - AgenticX 扩展: 框架特定的扩展属性
    """
    
    # ========== 操作元数据 ==========
    # 操作类型（chat, embedding, text_completion 等）
    AI_OPERATION_TYPE = "gen_ai.operation.name"
    # AI 系统/提供商（openai, anthropic, ollama 等）
    AI_PROVIDER = "gen_ai.system"
    
    # ========== 请求属性 ==========
    # 请求的模型名称
    REQUEST_MODEL = "gen_ai.request.model"
    # 温度参数
    REQUEST_TEMPERATURE = "gen_ai.request.temperature"
    # 最大生成 Token 数
    REQUEST_MAX_TOKENS = "gen_ai.request.max_tokens"
    # Top-P 采样参数
    REQUEST_TOP_P = "gen_ai.request.top_p"
    # Top-K 采样参数
    REQUEST_TOP_K = "gen_ai.request.top_k"
    # 频率惩罚
    REQUEST_FREQUENCY_PENALTY = "gen_ai.request.frequency_penalty"
    # 存在惩罚
    REQUEST_PRESENCE_PENALTY = "gen_ai.request.presence_penalty"
    # 停止序列
    REQUEST_STOP_SEQUENCES = "gen_ai.request.stop_sequences"
    # 工具名称列表
    REQUEST_TOOL_NAMES = "gen_ai.request.tool_names"
    
    # ========== 响应属性 ==========
    # 实际使用的模型名称（可能与请求不同）
    RESPONSE_MODEL = "gen_ai.response.model"
    # 响应唯一标识符
    RESPONSE_ID = "gen_ai.response.id"
    # 完成原因（stop, length, tool_calls 等）
    RESPONSE_FINISH_REASONS = "gen_ai.response.finish_reasons"
    
    # ========== Token 用量 ==========
    # 输入 Token 数（Prompt）
    USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens"
    # 输出 Token 数（Completion）
    USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens"
    # 总 Token 数
    USAGE_TOTAL_TOKENS = "gen_ai.usage.total_tokens"
    
    # ========== AgenticX 扩展属性（非 OpenTelemetry 标准）==========
    # Agent 唯一标识符
    AGENTICX_AGENT_ID = "agenticx.agent.id"
    # Agent 角色
    AGENTICX_AGENT_ROLE = "agenticx.agent.role"
    # 任务唯一标识符
    AGENTICX_TASK_ID = "agenticx.task.id"
    # 任务描述
    AGENTICX_TASK_DESCRIPTION = "agenticx.task.description"
    # 工具名称
    AGENTICX_TOOL_NAME = "agenticx.tool.name"
    # 工作流 ID
    AGENTICX_WORKFLOW_ID = "agenticx.workflow.id"
    # 会话 ID
    AGENTICX_SESSION_ID = "agenticx.session.id"
    # 错误类型
    AGENTICX_ERROR_TYPE = "agenticx.error.type"
    # 是否可恢复
    AGENTICX_ERROR_RECOVERABLE = "agenticx.error.recoverable"
    
    @classmethod
    def get_all_otel_attributes(cls) -> Dict[str, str]:
        """获取所有 OpenTelemetry 标准属性（排除 AgenticX 扩展）"""
        return {
            name: value for name, value in vars(cls).items()
            if isinstance(value, str) 
            and not name.startswith('_')
            and not name.startswith('AGENTICX_')
        }
    
    @classmethod
    def get_agenticx_attributes(cls) -> Dict[str, str]:
        """获取所有 AgenticX 扩展属性"""
        return {
            name: value for name, value in vars(cls).items()
            if isinstance(value, str) 
            and name.startswith('AGENTICX_')
        }
    
    @classmethod
    def get_all_attributes(cls) -> Dict[str, str]:
        """获取所有属性"""
        return {
            name: value for name, value in vars(cls).items()
            if isinstance(value, str) and not name.startswith('_')
        }


class LegacyMetricNames:
    """
    AgenticX 旧版指标名称（向后兼容）
    
    这些名称用于在 use_otel_naming=False 时保持向后兼容。
    """
    # 任务指标
    TASKS_TOTAL = "agenticx_tasks_total"
    TASKS_SUCCESS_TOTAL = "agenticx_tasks_success_total"
    TASKS_FAILURE_TOTAL = "agenticx_tasks_failure_total"
    TASK_DURATION_SECONDS = "agenticx_task_duration_seconds"
    
    # 工具指标
    TOOL_CALLS_TOTAL = "agenticx_tool_calls_total"
    TOOL_CALLS_SUCCESS_TOTAL = "agenticx_tool_calls_success_total"
    TOOL_CALLS_FAILURE_TOTAL = "agenticx_tool_calls_failure_total"
    TOOL_DURATION_SECONDS = "agenticx_tool_duration_seconds"
    
    # LLM 指标
    LLM_CALLS_TOTAL = "agenticx_llm_calls_total"
    LLM_TOKENS_TOTAL = "agenticx_llm_tokens_total"
    LLM_COST_TOTAL = "agenticx_llm_cost_total"
    LLM_DURATION_SECONDS = "agenticx_llm_duration_seconds"
    
    # 错误指标
    ERRORS_TOTAL = "agenticx_errors_total"
    ERROR_RATE = "agenticx_error_rate"
    
    # 系统指标
    CPU_USAGE_PERCENT = "agenticx_cpu_usage_percent"
    MEMORY_USAGE_PERCENT = "agenticx_memory_usage_percent"


class OTelMetricNames:
    """
    OpenTelemetry 语义约定的指标名称
    
    这些名称遵循 OpenTelemetry GenAI 语义约定，
    与 Grafana Cloud、Datadog 等平台的 AI 仪表盘兼容。
    """
    # 操作计数器（按 operation.name 和 system 分组）
    OPERATIONS_TOTAL = "gen_ai.client.operation.duration"  # histogram
    
    # Token 用量（按 model 和 system 分组）
    TOKEN_USAGE = "gen_ai.client.token.usage"
    
    # 以下为 AgenticX 特定指标（使用 agenticx 命名空间）
    # 任务指标
    TASKS_TOTAL = "agenticx.tasks.total"
    TASKS_DURATION = "agenticx.tasks.duration"
    
    # 工具指标
    TOOL_CALLS_TOTAL = "agenticx.tools.calls.total"
    TOOL_CALLS_DURATION = "agenticx.tools.calls.duration"
    
    # LLM 指标
    LLM_CALLS_TOTAL = "agenticx.llm.calls.total"
    LLM_TOKENS_INPUT = "agenticx.llm.tokens.input"
    LLM_TOKENS_OUTPUT = "agenticx.llm.tokens.output"
    LLM_TOKENS_TOTAL = "agenticx.llm.tokens.total"
    LLM_COST = "agenticx.llm.cost"
    LLM_DURATION = "agenticx.llm.duration"
    
    # 错误指标
    ERRORS_TOTAL = "agenticx.errors.total"
    ERROR_RATE = "agenticx.errors.rate"
    
    # 系统指标
    CPU_USAGE = "agenticx.system.cpu.usage"
    MEMORY_USAGE = "agenticx.system.memory.usage"


# 指标名称映射（旧名称 -> 新名称）
METRIC_NAME_MAPPING: Dict[str, str] = {
    LegacyMetricNames.TASKS_TOTAL: OTelMetricNames.TASKS_TOTAL,
    LegacyMetricNames.TASKS_SUCCESS_TOTAL: OTelMetricNames.TASKS_TOTAL,
    LegacyMetricNames.TASKS_FAILURE_TOTAL: OTelMetricNames.TASKS_TOTAL,
    LegacyMetricNames.LLM_CALLS_TOTAL: OTelMetricNames.LLM_CALLS_TOTAL,
    LegacyMetricNames.LLM_TOKENS_TOTAL: OTelMetricNames.LLM_TOKENS_TOTAL,
    LegacyMetricNames.LLM_COST_TOTAL: OTelMetricNames.LLM_COST,
    LegacyMetricNames.ERRORS_TOTAL: OTelMetricNames.ERRORS_TOTAL,
    LegacyMetricNames.CPU_USAGE_PERCENT: OTelMetricNames.CPU_USAGE,
    LegacyMetricNames.MEMORY_USAGE_PERCENT: OTelMetricNames.MEMORY_USAGE,
}

