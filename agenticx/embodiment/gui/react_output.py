"""
REACT Output Parser - REACT 结构化输出解析器
基于 AgentCPM-GUI 设计

支持格式：
1. <plan>...</plan><think>...</think><act>{...}</act>
2. <reflection>...</reflection><plan>...</plan><think>...</think><act>{...}</act>
3. <think>...</think><act>{...}</act>

来源：AgentCPM-GUI 框架
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
import re
import json
import logging

from agenticx.embodiment.gui.action_schema import (
    GUIActionCompact,
    GUIActionType,
    GUI_ACTION_SCHEMA,
)

logger = logging.getLogger(__name__)


@dataclass
class REACTOutput:
    """REACT 格式输出
    
    解析 REACT 格式的模型输出，提取 plan, reflection, think, act 等字段。
    
    Attributes:
        plan: 计划（可选）
        reflection: 反思（可选）
        think: 思考过程
        act: 动作（JSON 字符串）
        raw_output: 原始输出
    
    Example:
        >>> output_str = '''<think>需要点击搜索按钮</think>
        ... <act>{"action_type":"click","POINT":[500,300]}</act>'''
        >>> react = REACTOutput.parse(output_str)
        >>> print(react.think)
        需要点击搜索按钮
        >>> action = react.to_gui_action()
        >>> print(action.action_type)
        click
    """
    plan: Optional[str] = None
    reflection: Optional[str] = None
    think: str = ""
    act: str = ""  # JSON 动作字符串
    raw_output: str = ""
    
    @classmethod
    def parse(cls, raw_output: str) -> "REACTOutput":
        """解析 REACT 格式输出
        
        Args:
            raw_output: 原始输出字符串
            
        Returns:
            REACTOutput 实例
        """
        # 提取各个标签内容
        plan = cls._extract_tag_content(raw_output, "plan")
        reflection = cls._extract_tag_content(raw_output, "reflection")
        think = cls._extract_tag_content(raw_output, "think")
        act = cls._extract_tag_content(raw_output, "act")
        
        return cls(
            plan=plan,
            reflection=reflection,
            think=think or "",
            act=act or "",
            raw_output=raw_output,
        )
    
    @staticmethod
    def _extract_tag_content(text: str, tag: str) -> Optional[str]:
        """提取 XML 标签内容
        
        Args:
            text: 文本
            tag: 标签名
            
        Returns:
            标签内容或 None
        """
        # 使用正则表达式提取标签内容
        pattern = rf'<{tag}>(.*?)</{tag}>'
        match = re.search(pattern, text, re.DOTALL | re.IGNORECASE)
        if match:
            content = match.group(1).strip()
            return content if content else None
        return None
    
    def to_gui_action(self) -> Optional[GUIActionCompact]:
        """转换为 GUIActionCompact
        
        Returns:
            GUIActionCompact 实例或 None（解析失败时）
        """
        if not self.act:
            logger.warning("No action found in REACT output")
            return None
        
        try:
            # 尝试解析 JSON
            action_dict = json.loads(self.act)
            
            # 创建 GUIActionCompact 实例
            return GUIActionCompact(
                thought=self.think or action_dict.get("thought"),
                action_type=GUIActionType(action_dict.get("action_type", "click")),
                point=action_dict.get("POINT"),
                to=action_dict.get("to"),
                text=action_dict.get("TYPE"),
                press=action_dict.get("PRESS"),
                duration_ms=action_dict.get("duration_ms", 200),
                status=action_dict.get("STATUS"),
            )
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            logger.error(f"Failed to parse action JSON: {e}")
            logger.debug(f"Raw action: {self.act}")
            return None
    
    def validate_format(self, step_id: int = 0) -> List[str]:
        """验证输出格式
        
        Args:
            step_id: 步骤 ID（用于错误消息）
            
        Returns:
            错误消息列表，为空表示格式正确
        """
        errors = []
        
        # 检查 think 标签
        if not self.think:
            errors.append(f"Step {step_id}: Missing <think> tag")
        
        # 检查 act 标签
        if not self.act:
            errors.append(f"Step {step_id}: Missing <act> tag")
        else:
            # 验证 JSON 格式
            try:
                action_dict = json.loads(self.act)
                
                # 验证必需字段
                if "action_type" not in action_dict:
                    errors.append(f"Step {step_id}: Missing 'action_type' in action JSON")
                
                # 尝试创建 GUIActionCompact 验证
                action = self.to_gui_action()
                if action:
                    validation_errors = action.validate_action()
                    errors.extend([f"Step {step_id}: {e}" for e in validation_errors])
                
            except json.JSONDecodeError as e:
                errors.append(f"Step {step_id}: Invalid action JSON: {str(e)}")
        
        return errors
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典
        
        Returns:
            包含所有字段的字典
        """
        return {
            "plan": self.plan,
            "reflection": self.reflection,
            "think": self.think,
            "act": self.act,
            "raw_output": self.raw_output,
        }


class REACTPromptBuilder:
    """REACT Prompt 构建器
    
    根据动作 Schema 构建 REACT 格式的系统提示词。
    
    Example:
        >>> builder = REACTPromptBuilder()
        >>> prompt = builder.build(GUI_ACTION_SCHEMA, language="zh")
        >>> print(prompt[:100])
    """
    
    # 中文系统提示词模板
    SYSTEM_PROMPT_ZH: str = """# Role
你是一个智能 GUI 自动化助手

# 输出格式
你需要按照以下 REACT 格式输出：

<think>将你的思考过程放在这两个 tag 之间</think>
<act>{{...用紧凑 JSON 串表示的动作...}}</act>

# 规则
- 你必须在 <think> 标签中写下你的思考过程
- 你必须在 <act> 标签中写下你的动作（JSON 格式）
- 输出的动作必须遵循下面的 Schema 约束

# Schema
{schema}

# 示例
<think>我需要点击屏幕中央的搜索按钮</think>
<act>{{"action_type":"click","POINT":[500,300]}}</act>
"""
    
    # 英文系统提示词模板
    SYSTEM_PROMPT_EN: str = """# Role
You are an intelligent GUI automation assistant

# Output Format
You need to output in the following REACT format:

<think>Put your reasoning process between these two tags</think>
<act>{{...compact JSON string representing the action...}}</act>

# Rules
- You MUST write your reasoning process in the <think> tag
- You MUST write your action (in JSON format) in the <act> tag
- The action MUST follow the Schema constraints below

# Schema
{schema}

# Example
<think>I need to click the search button in the center of the screen</think>
<act>{{"action_type":"click","POINT":[500,300]}}</act>
"""
    
    # 中文增强提示词（包含 plan 和 reflection）
    SYSTEM_PROMPT_ZH_ENHANCED: str = """# Role
你是一个智能 GUI 自动化助手

# 输出格式
你需要按照以下 REACT 格式输出：

<reflection>（可选）反思上一步的执行结果</reflection>
<plan>（可选）制定接下来的计划</plan>
<think>将你的思考过程放在这两个 tag 之间</think>
<act>{{...用紧凑 JSON 串表示的动作...}}</act>

# 规则
- <reflection> 和 <plan> 标签是可选的
- 你必须在 <think> 标签中写下你的思考过程
- 你必须在 <act> 标签中写下你的动作（JSON 格式）
- 输出的动作必须遵循下面的 Schema 约束

# Schema
{schema}

# 示例
<reflection>上一步点击成功，搜索框已经打开</reflection>
<plan>接下来需要在搜索框中输入关键词，然后点击搜索</plan>
<think>我需要在搜索框中输入 "AgenticX"</think>
<act>{{"action_type":"type","TYPE":"AgenticX"}}</act>
"""
    
    @classmethod
    def build(
        cls,
        schema: Optional[Dict[str, Any]] = None,
        language: str = "zh",
        enhanced: bool = False,
    ) -> str:
        """构建 REACT 格式的系统提示词
        
        Args:
            schema: 动作 Schema（默认使用 GUI_ACTION_SCHEMA）
            language: 语言（"zh" 或 "en"）
            enhanced: 是否使用增强格式（包含 reflection 和 plan）
            
        Returns:
            系统提示词字符串
        """
        if schema is None:
            schema = GUI_ACTION_SCHEMA
        
        # 格式化 Schema
        schema_str = json.dumps(schema, ensure_ascii=False, indent=2)
        
        # 选择模板
        if language == "zh":
            template = cls.SYSTEM_PROMPT_ZH_ENHANCED if enhanced else cls.SYSTEM_PROMPT_ZH
        else:
            template = cls.SYSTEM_PROMPT_EN
        
        return template.format(schema=schema_str)
    
    @classmethod
    def build_user_prompt(
        cls,
        task_goal: str,
        screen_description: Optional[str] = None,
        history: Optional[List[Dict[str, Any]]] = None,
        language: str = "zh",
    ) -> str:
        """构建用户提示词
        
        Args:
            task_goal: 任务目标
            screen_description: 屏幕描述（可选）
            history: 历史动作列表（可选）
            language: 语言
            
        Returns:
            用户提示词字符串
        """
        if language == "zh":
            prompt_parts = [f"# 任务目标\n{task_goal}"]
            
            if screen_description:
                prompt_parts.append(f"\n# 当前屏幕\n{screen_description}")
            
            if history:
                prompt_parts.append("\n# 历史动作")
                for i, step in enumerate(history[-3:], 1):  # 只显示最近 3 步
                    prompt_parts.append(f"{i}. {step.get('think', '')} -> {step.get('outcome', '')}")
            
            prompt_parts.append("\n# 你的输出")
            prompt_parts.append("请按照 REACT 格式输出下一步动作：")
            
        else:
            prompt_parts = [f"# Task Goal\n{task_goal}"]
            
            if screen_description:
                prompt_parts.append(f"\n# Current Screen\n{screen_description}")
            
            if history:
                prompt_parts.append("\n# History")
                for i, step in enumerate(history[-3:], 1):
                    prompt_parts.append(f"{i}. {step.get('think', '')} -> {step.get('outcome', '')}")
            
            prompt_parts.append("\n# Your Output")
            prompt_parts.append("Please output the next action in REACT format:")
        
        return "\n".join(prompt_parts)
