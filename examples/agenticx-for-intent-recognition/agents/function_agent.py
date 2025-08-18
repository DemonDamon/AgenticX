"""工具调用意图Agent

专门处理002类型的工具调用意图，包括参数抽取和工具匹配。
"""

from typing import Dict, List, Optional, Any
from agenticx.core import Agent, Task, AgentResult, AgentContext

from .intent_agent import IntentRecognitionAgent
from .models import IntentType, IntentResult, IntentContext, AgentConfig, Entity


class FunctionIntentAgent(IntentRecognitionAgent):
    """工具调用意图Agent
    
    继承IntentRecognitionAgent，专门处理工具调用意图(002类型)。
    集成参数抽取和工具匹配功能。
    """
    
    def __init__(self, config: AgentConfig = None):
        """初始化工具调用意图Agent"""
        super().__init__(config)
        
        # 覆盖提示词模板，专门针对工具调用意图
        self.prompt_template = self._get_function_prompt()
        
        # 预定义的工具类型
        self.tool_types = {
            "file_operation": ["打开", "保存", "删除", "复制", "移动", "重命名"],
            "system_control": ["关机", "重启", "睡眠", "锁屏", "音量", "亮度"],
            "application": ["启动", "运行", "打开应用", "关闭应用", "切换"],
            "data_processing": ["计算", "统计", "分析", "转换", "处理"],
            "communication": ["发送", "接收", "邮件", "消息", "通知"],
            "automation": ["定时", "自动", "批量", "脚本", "任务"],
            "search_action": ["搜索文件", "查找", "定位", "筛选"],
            "configuration": ["设置", "配置", "调整", "修改", "更改"]
        }
    
    def _get_function_prompt(self) -> str:
        """获取工具调用意图识别的专用提示词模板"""
        return """
你是一个专业的工具调用意图分析助手，专门识别用户想要执行的具体功能和操作。

工具调用意图类型包括：
1. 文件操作 (file_operation) - 文件的增删改查操作
2. 系统控制 (system_control) - 系统级别的控制操作
3. 应用程序 (application) - 应用程序的启动、关闭等
4. 数据处理 (data_processing) - 数据计算、分析、转换
5. 通信功能 (communication) - 发送消息、邮件等
6. 自动化任务 (automation) - 定时任务、批量操作
7. 搜索操作 (search_action) - 文件搜索、内容查找
8. 配置设置 (configuration) - 系统或应用配置

请分析以下用户输入，识别工具调用意图并提取操作参数：

用户输入: {user_input}

返回格式：
{{
    "intent_type": "002",
    "confidence": 置信度(0-1之间的浮点数),
    "intent_code": "002_具体工具类型",
    "description": "工具调用意图描述",
    "tool_category": "工具类别",
    "action": "具体操作动作",
    "parameters": {{
        "target": "操作目标",
        "method": "操作方法",
        "options": ["操作选项列表"]
    }},
    "entities": [
        {{
            "text": "实体文本",
            "label": "实体类型",
            "start": 起始位置,
            "end": 结束位置,
            "confidence": 置信度
        }}
    ],
    "execution_priority": "执行优先级(low/medium/high)",
    "requires_confirmation": "是否需要确认(true/false)"
}}

请确保返回有效的JSON格式。
"""
    
    def recognize_intent(self, context: IntentContext) -> IntentResult:
        """识别工具调用意图
        
        重写父类方法，添加参数抽取和工具匹配。
        
        Args:
            context: 意图识别上下文
            
        Returns:
            IntentResult: 增强的工具调用意图识别结果
        """
        # 调用父类的基础识别方法
        result = super().recognize_intent(context)
        
        # 如果识别结果不是工具调用类型，进行强制转换
        if result.intent_type != IntentType.FUNCTION:
            result.intent_type = IntentType.FUNCTION
            result.intent_code = self._classify_function_intent(context.user_input)
            result.description = "工具调用意图"
        
        # 提取操作参数
        parameters = self._extract_function_parameters(context.user_input)
        result.metadata.update(parameters)
        
        # 提取相关实体
        entities = self._extract_function_entities(context.user_input)
        result.entities = entities
        
        return result
    
    def _classify_function_intent(self, user_input: str) -> str:
        """分类工具调用意图的具体子类型
        
        Args:
            user_input: 用户输入
            
        Returns:
            str: 具体的工具调用意图编码
        """
        user_input_lower = user_input.lower()
        
        # 遍历工具类型，找到最匹配的类别
        for tool_category, keywords in self.tool_types.items():
            if any(keyword in user_input_lower for keyword in keywords):
                return f"002_{tool_category}"
        
        # 默认返回通用工具调用
        return "002_general_function"
    
    def _extract_function_parameters(self, user_input: str) -> Dict[str, Any]:
        """提取工具调用的参数
        
        Args:
            user_input: 用户输入
            
        Returns:
            Dict[str, Any]: 提取的参数信息
        """
        # 识别操作动作
        action = self._identify_action(user_input)
        
        # 识别操作目标
        target = self._identify_target(user_input)
        
        # 识别操作方法
        method = self._identify_method(user_input)
        
        # 识别操作选项
        options = self._identify_options(user_input)
        
        # 评估执行优先级
        priority = self._assess_execution_priority(user_input)
        
        # 判断是否需要确认
        requires_confirmation = self._requires_confirmation(user_input)
        
        # 确定工具类别
        tool_category = self._determine_tool_category(user_input)
        
        return {
            "tool_category": tool_category,
            "action": action,
            "parameters": {
                "target": target,
                "method": method,
                "options": options
            },
            "execution_priority": priority,
            "requires_confirmation": requires_confirmation
        }
    
    def _identify_action(self, user_input: str) -> str:
        """识别具体的操作动作
        
        Args:
            user_input: 用户输入
            
        Returns:
            str: 操作动作
        """
        user_input_lower = user_input.lower()
        
        action_keywords = {
            "create": ["创建", "新建", "建立", "生成", "create", "new", "make"],
            "delete": ["删除", "移除", "清除", "delete", "remove", "clear"],
            "modify": ["修改", "编辑", "更改", "调整", "modify", "edit", "change"],
            "copy": ["复制", "拷贝", "copy", "duplicate"],
            "move": ["移动", "转移", "move", "transfer"],
            "open": ["打开", "启动", "运行", "open", "start", "run", "launch"],
            "close": ["关闭", "停止", "结束", "close", "stop", "end"],
            "save": ["保存", "存储", "save", "store"],
            "search": ["搜索", "查找", "寻找", "search", "find", "look for"],
            "send": ["发送", "传送", "send", "transmit"],
            "receive": ["接收", "获取", "receive", "get"],
            "calculate": ["计算", "统计", "分析", "calculate", "compute", "analyze"]
        }
        
        for action, keywords in action_keywords.items():
            if any(keyword in user_input_lower for keyword in keywords):
                return action
        
        return "execute"  # 默认动作
    
    def _identify_target(self, user_input: str) -> str:
        """识别操作目标
        
        Args:
            user_input: 用户输入
            
        Returns:
            str: 操作目标
        """
        import re
        
        # 文件路径模式
        file_patterns = [
            r'[A-Za-z]:\\[^\s]+',  # Windows路径
            r'/[^\s]+',  # Unix路径
            r'[^\s]+\.[a-zA-Z]{2,4}',  # 文件扩展名
        ]
        
        for pattern in file_patterns:
            match = re.search(pattern, user_input)
            if match:
                return match.group()
        
        # 应用程序名称
        app_keywords = ["微信", "QQ", "浏览器", "记事本", "计算器", "word", "excel", "chrome", "firefox"]
        user_input_lower = user_input.lower()
        
        for app in app_keywords:
            if app.lower() in user_input_lower:
                return app
        
        # 提取引号中的内容
        # 分别匹配不同类型的引号
        patterns = [
            r'"(.*?)"',  # 英文双引号
            r'"(.*?)"',  # 中文左双引号
            r'"(.*?)"',  # 中文右双引号
            r"'(.*?)'",  # 英文单引号
            r'\u2018(.*?)\u2019',  # 中文左右单引号 Unicode
        ]
        
        for pattern in patterns:
            matches = re.findall(pattern, user_input)
            if matches:
                return matches[0]
        
        # 提取可能的目标词
        target_patterns = [
            r'(?:打开|关闭|删除|修改|创建)\s*([^\s，。！？]+)',
            r'([^\s，。！？]+)(?:\s*文件|\s*应用|\s*程序)',
        ]
        
        for pattern in target_patterns:
            match = re.search(pattern, user_input)
            if match:
                return match.group(1)
        
        return "未指定"
    
    def _identify_method(self, user_input: str) -> str:
        """识别操作方法
        
        Args:
            user_input: 用户输入
            
        Returns:
            str: 操作方法
        """
        user_input_lower = user_input.lower()
        
        method_keywords = {
            "automatic": ["自动", "自动化", "批量", "automatic", "auto", "batch"],
            "manual": ["手动", "手工", "逐个", "manual", "manually", "one by one"],
            "scheduled": ["定时", "计划", "scheduled", "timer", "cron"],
            "immediate": ["立即", "马上", "现在", "immediate", "now", "right away"],
            "conditional": ["如果", "当", "条件", "if", "when", "conditional"]
        }
        
        for method, keywords in method_keywords.items():
            if any(keyword in user_input_lower for keyword in keywords):
                return method
        
        return "default"
    
    def _identify_options(self, user_input: str) -> List[str]:
        """识别操作选项
        
        Args:
            user_input: 用户输入
            
        Returns:
            List[str]: 操作选项列表
        """
        options = []
        user_input_lower = user_input.lower()
        
        option_keywords = {
            "force": ["强制", "强行", "force", "forcefully"],
            "recursive": ["递归", "包含子目录", "recursive", "recursively"],
            "backup": ["备份", "保留副本", "backup", "keep copy"],
            "overwrite": ["覆盖", "替换", "overwrite", "replace"],
            "silent": ["静默", "不提示", "silent", "quiet"],
            "verbose": ["详细", "显示过程", "verbose", "detailed"]
        }
        
        for option, keywords in option_keywords.items():
            if any(keyword in user_input_lower for keyword in keywords):
                options.append(option)
        
        return options
    
    def _assess_execution_priority(self, user_input: str) -> str:
        """评估执行优先级
        
        Args:
            user_input: 用户输入
            
        Returns:
            str: 执行优先级
        """
        user_input_lower = user_input.lower()
        
        high_priority_keywords = ["紧急", "立即", "马上", "urgent", "immediately", "asap", "critical"]
        medium_priority_keywords = ["尽快", "优先", "soon", "priority", "important"]
        
        if any(keyword in user_input_lower for keyword in high_priority_keywords):
            return "high"
        elif any(keyword in user_input_lower for keyword in medium_priority_keywords):
            return "medium"
        else:
            return "low"
    
    def _requires_confirmation(self, user_input: str) -> bool:
        """判断是否需要确认
        
        Args:
            user_input: 用户输入
            
        Returns:
            bool: 是否需要确认
        """
        user_input_lower = user_input.lower()
        
        # 危险操作关键词
        dangerous_keywords = ["删除", "清除", "格式化", "重置", "delete", "remove", "format", "reset", "clear"]
        
        # 系统级操作关键词
        system_keywords = ["关机", "重启", "shutdown", "reboot", "restart"]
        
        # 批量操作关键词
        batch_keywords = ["批量", "全部", "所有", "batch", "all", "everything"]
        
        return any(keyword in user_input_lower for keyword in dangerous_keywords + system_keywords + batch_keywords)
    
    def _determine_tool_category(self, user_input: str) -> str:
        """确定工具类别
        
        Args:
            user_input: 用户输入
            
        Returns:
            str: 工具类别
        """
        user_input_lower = user_input.lower()
        
        for tool_category, keywords in self.tool_types.items():
            if any(keyword in user_input_lower for keyword in keywords):
                return tool_category
        
        return "general"
    
    def _extract_function_entities(self, user_input: str) -> List[Entity]:
        """提取工具调用相关的实体
        
        Args:
            user_input: 用户输入
            
        Returns:
            List[Entity]: 提取的实体列表
        """
        entities = []
        import re
        
        # 文件路径实体
        file_patterns = [
            r'[A-Za-z]:\\[^\s，。！？]+',  # Windows路径
            r'/[^\s，。！？]+',  # Unix路径
            r'[^\s，。！？]+\.[a-zA-Z]{2,4}',  # 文件扩展名
        ]
        
        for pattern in file_patterns:
            matches = re.finditer(pattern, user_input)
            for match in matches:
                entities.append(Entity(
                    text=match.group(),
                    label="FILE_PATH",
                    start=match.start(),
                    end=match.end(),
                    confidence=0.9
                ))
        
        # 应用程序实体
        app_patterns = [
            r'(?:微信|QQ|浏览器|记事本|计算器|word|excel|chrome|firefox|photoshop)',
        ]
        
        for pattern in app_patterns:
            matches = re.finditer(pattern, user_input, re.IGNORECASE)
            for match in matches:
                entities.append(Entity(
                    text=match.group(),
                    label="APPLICATION",
                    start=match.start(),
                    end=match.end(),
                    confidence=0.8
                ))
        
        # 数值参数实体
        number_patterns = [
            r'\d+(?:\.\d+)?(?:MB|GB|KB|秒|分钟|小时|天)',
            r'\d+(?:\.\d+)?%',
            r'\d+(?:\.\d+)?'
        ]
        
        for pattern in number_patterns:
            matches = re.finditer(pattern, user_input)
            for match in matches:
                entities.append(Entity(
                    text=match.group(),
                    label="PARAMETER",
                    start=match.start(),
                    end=match.end(),
                    confidence=0.7
                ))
        
        return entities
    
    def get_tool_suggestions(self, user_input: str) -> List[Dict[str, Any]]:
        """获取工具建议
        
        Args:
            user_input: 用户输入
            
        Returns:
            List[Dict[str, Any]]: 工具建议列表
        """
        suggestions = []
        
        # 基于意图分类提供工具建议
        intent_code = self._classify_function_intent(user_input)
        tool_category = intent_code.replace("002_", "")
        
        if tool_category == "file_operation":
            suggestions = [
                {"tool": "file_manager", "description": "文件管理器", "confidence": 0.9},
                {"tool": "command_line", "description": "命令行工具", "confidence": 0.7},
                {"tool": "batch_processor", "description": "批处理工具", "confidence": 0.6}
            ]
        elif tool_category == "system_control":
            suggestions = [
                {"tool": "system_controller", "description": "系统控制器", "confidence": 0.9},
                {"tool": "power_manager", "description": "电源管理", "confidence": 0.8},
                {"tool": "settings_app", "description": "系统设置", "confidence": 0.7}
            ]
        elif tool_category == "application":
            suggestions = [
                {"tool": "app_launcher", "description": "应用启动器", "confidence": 0.9},
                {"tool": "task_manager", "description": "任务管理器", "confidence": 0.8},
                {"tool": "process_monitor", "description": "进程监控", "confidence": 0.6}
            ]
        
        return suggestions