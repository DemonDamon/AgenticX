"""
Token Counter (Token 计数器)

提供精确的 Token 计数能力，支持多种模型的分词规则。

功能：
- 精确计数：使用 tiktoken 进行精确的 token 计数
- 多模型支持：支持 GPT-3.5/4、Claude 等主流模型
- 降级机制：tiktoken 不可用时自动降级为字符估算
- 成本估算：根据 token 数和模型定价估算成本
"""

from typing import Optional, Dict, Any, List, Union
from enum import Enum
import logging

logger = logging.getLogger(__name__)

# 尝试导入 tiktoken
try:
    import tiktoken  # type: ignore[import-untyped]
    TIKTOKEN_AVAILABLE = True
except ImportError:
    TIKTOKEN_AVAILABLE = False
    logger.warning("tiktoken not installed. Token counting will use character-based estimation.")


class ModelFamily(str, Enum):
    """支持的模型家族"""
    GPT4 = "gpt-4"
    GPT4O = "gpt-4o"
    GPT35_TURBO = "gpt-3.5-turbo"
    CLAUDE = "claude"
    GEMINI = "gemini"
    QWEN = "qwen"
    DEEPSEEK = "deepseek"
    UNKNOWN = "unknown"


# 模型到 tiktoken 编码的映射
MODEL_TO_ENCODING = {
    ModelFamily.GPT4: "cl100k_base",
    ModelFamily.GPT4O: "o200k_base",
    ModelFamily.GPT35_TURBO: "cl100k_base",
    ModelFamily.CLAUDE: "cl100k_base",  # Claude 使用类似 GPT-4 的分词
    ModelFamily.GEMINI: "cl100k_base",  # Gemini 近似
    ModelFamily.QWEN: "cl100k_base",    # 通义千问近似
    ModelFamily.DEEPSEEK: "cl100k_base", # DeepSeek 近似
    ModelFamily.UNKNOWN: "cl100k_base",
}

# 模型定价（每 1K tokens，单位：美元）
MODEL_PRICING = {
    ModelFamily.GPT4: {"input": 0.03, "output": 0.06},
    ModelFamily.GPT4O: {"input": 0.0025, "output": 0.01},
    ModelFamily.GPT35_TURBO: {"input": 0.0005, "output": 0.0015},
    ModelFamily.CLAUDE: {"input": 0.008, "output": 0.024},  # Claude 3 Sonnet
    ModelFamily.GEMINI: {"input": 0.00025, "output": 0.0005},  # Gemini 1.5 Flash
    ModelFamily.QWEN: {"input": 0.0008, "output": 0.002},  # 通义千问 Plus
    ModelFamily.DEEPSEEK: {"input": 0.00014, "output": 0.00028},  # DeepSeek V3
    ModelFamily.UNKNOWN: {"input": 0.001, "output": 0.002},
}

# 中文字符的额外系数（中文通常比英文消耗更多 token）
CJK_TOKEN_MULTIPLIER = 1.5


class TokenCounter:
    """
    Token 计数器
    
    提供精确的 token 计数，支持多种模型和降级机制。
    """
    
    def __init__(
        self, 
        model: Optional[str] = None,
        chars_per_token_fallback: int = 4
    ):
        """
        Args:
            model: 模型名称（用于选择正确的分词器）
            chars_per_token_fallback: tiktoken 不可用时的降级系数
        """
        self.model = model
        self.model_family = self._detect_model_family(model)
        self.chars_per_token_fallback = chars_per_token_fallback
        self._encoder = None
        
        if TIKTOKEN_AVAILABLE:
            self._init_encoder()
    
    def _detect_model_family(self, model: Optional[str]) -> ModelFamily:
        """检测模型所属的家族。"""
        if not model:
            return ModelFamily.UNKNOWN
        
        model_lower = model.lower()
        
        if "gpt-4o" in model_lower or "gpt4o" in model_lower:
            return ModelFamily.GPT4O
        elif "gpt-4" in model_lower or "gpt4" in model_lower:
            return ModelFamily.GPT4
        elif "gpt-3.5" in model_lower or "gpt35" in model_lower:
            return ModelFamily.GPT35_TURBO
        elif "claude" in model_lower:
            return ModelFamily.CLAUDE
        elif "gemini" in model_lower:
            return ModelFamily.GEMINI
        elif "qwen" in model_lower or "通义" in model_lower:
            return ModelFamily.QWEN
        elif "deepseek" in model_lower:
            return ModelFamily.DEEPSEEK
        else:
            return ModelFamily.UNKNOWN
    
    def _init_encoder(self) -> None:
        """初始化 tiktoken 编码器。"""
        if not TIKTOKEN_AVAILABLE:
            return
        
        encoding_name = MODEL_TO_ENCODING.get(self.model_family, "cl100k_base")
        try:
            self._encoder = tiktoken.get_encoding(encoding_name)
            logger.debug(f"Initialized tiktoken encoder: {encoding_name}")
        except Exception as e:
            logger.warning(f"Failed to initialize tiktoken encoder: {e}")
            self._encoder = None
    
    def count_tokens(self, text: str) -> int:
        """
        计算文本的 token 数。
        
        Args:
            text: 要计数的文本
            
        Returns:
            Token 数量
        """
        if not text:
            return 0
        
        if self._encoder:
            try:
                return len(self._encoder.encode(text))
            except Exception as e:
                logger.warning(f"tiktoken encoding failed, falling back: {e}")
        
        # 降级：基于字符估算
        return self._estimate_tokens_by_chars(text)
    
    def _estimate_tokens_by_chars(self, text: str) -> int:
        """
        基于字符数估算 token 数（降级方案）。
        
        考虑因素：
        - 英文平均 4 字符 = 1 token
        - 中文/日文/韩文通常 1-2 字符 = 1 token
        """
        if not text:
            return 0
        
        # 统计 CJK 字符（中日韩）
        cjk_count = sum(1 for char in text if self._is_cjk(char))
        other_count = len(text) - cjk_count
        
        # 分别估算
        cjk_tokens = cjk_count * CJK_TOKEN_MULTIPLIER
        other_tokens = other_count / self.chars_per_token_fallback
        
        return int(cjk_tokens + other_tokens)
    
    @staticmethod
    def _is_cjk(char: str) -> bool:
        """判断字符是否为 CJK 字符。"""
        code = ord(char)
        return (
            0x4E00 <= code <= 0x9FFF or   # CJK Unified Ideographs
            0x3400 <= code <= 0x4DBF or   # CJK Extension A
            0x20000 <= code <= 0x2A6DF or # CJK Extension B
            0xF900 <= code <= 0xFAFF or   # CJK Compatibility Ideographs
            0x3040 <= code <= 0x309F or   # Hiragana
            0x30A0 <= code <= 0x30FF or   # Katakana
            0xAC00 <= code <= 0xD7AF      # Hangul Syllables
        )
    
    def count_messages_tokens(self, messages: List[Dict[str, Any]]) -> int:
        """
        计算消息列表的 token 数（OpenAI 格式）。
        
        包含消息格式的额外开销。
        
        Args:
            messages: OpenAI 格式的消息列表
            
        Returns:
            Token 数量
        """
        if not messages:
            return 0
        
        total = 0
        
        # 每条消息有固定开销
        tokens_per_message = 4  # <im_start>, role, \n, <im_end>
        tokens_per_name = -1    # 如果有 name 字段
        
        for message in messages:
            total += tokens_per_message
            
            for key, value in message.items():
                if isinstance(value, str):
                    total += self.count_tokens(value)
                if key == "name":
                    total += tokens_per_name
        
        total += 2  # 回复的前置 token
        
        return total
    
    def estimate_cost(
        self, 
        input_tokens: int, 
        output_tokens: int = 0
    ) -> Dict[str, float]:
        """
        估算 token 的成本。
        
        Args:
            input_tokens: 输入 token 数
            output_tokens: 输出 token 数
            
        Returns:
            成本明细字典
        """
        pricing = MODEL_PRICING.get(self.model_family, MODEL_PRICING[ModelFamily.UNKNOWN])
        
        input_cost = (input_tokens / 1000) * pricing["input"]
        output_cost = (output_tokens / 1000) * pricing["output"]
        
        return {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
            "input_cost_usd": round(input_cost, 6),
            "output_cost_usd": round(output_cost, 6),
            "total_cost_usd": round(input_cost + output_cost, 6),
            "model_family": self.model_family.value
        }
    
    def truncate_to_token_limit(
        self, 
        text: str, 
        max_tokens: int,
        truncation_suffix: str = "..."
    ) -> str:
        """
        将文本截断到指定的 token 限制。
        
        Args:
            text: 原始文本
            max_tokens: 最大 token 数
            truncation_suffix: 截断后添加的后缀
            
        Returns:
            截断后的文本
        """
        if not text:
            return text
        
        current_tokens = self.count_tokens(text)
        if current_tokens <= max_tokens:
            return text
        
        # 二分查找截断点
        suffix_tokens = self.count_tokens(truncation_suffix)
        target_tokens = max_tokens - suffix_tokens
        
        if target_tokens <= 0:
            return truncation_suffix
        
        low, high = 0, len(text)
        while low < high:
            mid = (low + high + 1) // 2
            if self.count_tokens(text[:mid]) <= target_tokens:
                low = mid
            else:
                high = mid - 1
        
        return text[:low] + truncation_suffix


class TokenStats:
    """
    Token 统计收集器
    
    用于收集和汇总 token 使用情况。
    """
    
    def __init__(self, model: Optional[str] = None):
        self.counter = TokenCounter(model=model)
        self.total_input_tokens = 0
        self.total_output_tokens = 0
        self.call_count = 0
        self.history: List[Dict[str, Any]] = []
    
    def record(
        self, 
        input_text: str, 
        output_text: str = "",
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        记录一次 token 使用。
        
        Args:
            input_text: 输入文本
            output_text: 输出文本
            metadata: 额外元数据
            
        Returns:
            本次使用的统计信息
        """
        input_tokens = self.counter.count_tokens(input_text)
        output_tokens = self.counter.count_tokens(output_text)
        
        self.total_input_tokens += input_tokens
        self.total_output_tokens += output_tokens
        self.call_count += 1
        
        record = {
            "call_index": self.call_count,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
            "cumulative_input": self.total_input_tokens,
            "cumulative_output": self.total_output_tokens,
            "metadata": metadata or {}
        }
        
        self.history.append(record)
        return record
    
    def get_summary(self) -> Dict[str, Any]:
        """获取统计摘要。"""
        cost = self.counter.estimate_cost(
            self.total_input_tokens, 
            self.total_output_tokens
        )
        
        return {
            "total_calls": self.call_count,
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "total_tokens": self.total_input_tokens + self.total_output_tokens,
            "estimated_cost": cost,
            "average_tokens_per_call": (
                (self.total_input_tokens + self.total_output_tokens) / max(self.call_count, 1)
            )
        }
    
    def reset(self) -> None:
        """重置统计。"""
        self.total_input_tokens = 0
        self.total_output_tokens = 0
        self.call_count = 0
        self.history.clear()


# =============================================================================
# 便捷函数
# =============================================================================

def count_tokens(text: str, model: Optional[str] = None) -> int:
    """快速计算文本的 token 数。"""
    return TokenCounter(model=model).count_tokens(text)


def estimate_cost(
    input_tokens: int, 
    output_tokens: int = 0, 
    model: Optional[str] = None
) -> Dict[str, float]:
    """快速估算 token 成本。"""
    return TokenCounter(model=model).estimate_cost(input_tokens, output_tokens)


def truncate_text(
    text: str, 
    max_tokens: int, 
    model: Optional[str] = None
) -> str:
    """快速截断文本到 token 限制。"""
    return TokenCounter(model=model).truncate_to_token_limit(text, max_tokens)

