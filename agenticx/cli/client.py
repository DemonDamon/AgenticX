#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
AgenticX 统一SDK客户端
封装所有核心功能，提供高级API接口
"""

import asyncio
import json
import yaml
import subprocess
from typing import Dict, List, Optional, Any, Union
from pathlib import Path
from pydantic import BaseModel, Field
from dataclasses import dataclass

from agenticx.core import Agent, Task, Workflow
from agenticx.core.agent_executor import AgentExecutor
from agenticx.core.workflow_engine import WorkflowEngine
from agenticx.observability.callbacks import CallbackManager
from agenticx.llms.litellm_provider import LiteLLMProvider


class ValidationResult(BaseModel):
    """配置验证结果"""
    is_valid: bool = Field(default=False, description="是否有效")
    errors: List[str] = Field(default_factory=list, description="错误列表")
    warnings: List[str] = Field(default_factory=list, description="警告列表")


class TestResult(BaseModel):
    """测试结果"""
    success: bool = Field(default=False, description="是否成功")
    tests_run: int = Field(default=0, description="运行测试数")
    failures: int = Field(default=0, description="失败测试数")
    errors: int = Field(default=0, description="错误测试数")
    failure_details: List[str] = Field(default_factory=list, description="失败详情")


@dataclass
class AgentInfo:
    """智能体信息"""
    id: str
    name: str
    role: str
    status: str
    version: str = "1.0.0"


@dataclass
class WorkflowInfo:
    """工作流信息"""
    id: str
    name: str
    node_count: int
    status: str
    version: str = "1.0.0"


class AgenticXClient:
    """AgenticX 统一客户端"""
    
    def __init__(
        self,
        config_path: Optional[str] = None,
        verbose: bool = False,
        debug: bool = False
    ):
        """初始化客户端
        
        Args:
            config_path: 配置文件路径
            verbose: 详细输出
            debug: 调试模式
        """
        self.config_path = config_path
        self.verbose = verbose
        self.debug = debug
        self.config = self._load_config()
        
        # 初始化组件
        self.callback_manager = CallbackManager()
        self.llm_provider = None
        self.workflow_engine = None
        
        self._initialize_components()
    
    def _load_config(self) -> Dict[str, Any]:
        """加载配置文件"""
        if not self.config_path:
            return {}
            
        config_path = Path(self.config_path)
        if not config_path.exists():
            return {}
            
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                if config_path.suffix in ['.yaml', '.yml']:
                    return yaml.safe_load(f)
                else:
                    return json.load(f)
        except Exception as e:
            if self.verbose:
                print(f"配置文件加载失败: {e}")
            return {}
    
    def _initialize_components(self):
        """初始化组件"""
        # 初始化LLM提供者
        llm_config = self.config.get('llm', {})
        if llm_config:
            self.llm_provider = LiteLLMProvider(**llm_config)
        
        # 初始化工作流引擎
        self.workflow_engine = WorkflowEngine()
    
    def run_workflow_file(self, file_path: str) -> Any:
        """执行工作流文件
        
        Args:
            file_path: 工作流文件路径
            
        Returns:
            执行结果
        """
        if self.verbose:
            print(f"执行工作流文件: {file_path}")
            
        # 动态加载工作流文件
        import importlib.util
        spec = importlib.util.spec_from_file_location("workflow_module", file_path)
        if spec is None:
            raise ValueError(f"无法加载工作流文件: {file_path}")
        module = importlib.util.module_from_spec(spec)
        if spec.loader is None:
            raise ValueError(f"无法获取工作流文件加载器: {file_path}")
        spec.loader.exec_module(module)
        
        # 查找并执行主函数
        if hasattr(module, 'main'):
            return module.main()
        elif hasattr(module, 'run'):
            return module.run()
        else:
            raise ValueError("工作流文件必须包含 main() 或 run() 函数")
    
    def validate_config(self, config_path: str, schema: Optional[str] = None) -> ValidationResult:
        """验证配置文件
        
        Args:
            config_path: 配置文件路径
            schema: 验证模式
            
        Returns:
            验证结果
        """
        result = ValidationResult()
        
        try:
            # 检查文件是否存在
            if not Path(config_path).exists():
                result.errors.append(f"配置文件不存在: {config_path}")
                return result
            
            # 加载配置文件
            with open(config_path, 'r', encoding='utf-8') as f:
                if config_path.endswith(('.yaml', '.yml')):
                    config = yaml.safe_load(f)
                else:
                    config = json.load(f)
            
            # 基础验证
            if not isinstance(config, dict):
                result.errors.append("配置文件必须是字典格式")
                return result
            
            # 验证必要字段
            required_fields = ['agents', 'workflows']
            for field in required_fields:
                if field not in config:
                    result.warnings.append(f"缺少推荐字段: {field}")
            
            # 验证智能体配置
            if 'agents' in config:
                self._validate_agents_config(config['agents'], result)
            
            # 验证工作流配置
            if 'workflows' in config:
                self._validate_workflows_config(config['workflows'], result)
            
            # 如果没有错误，则验证通过
            result.is_valid = len(result.errors) == 0
            
        except Exception as e:
            result.errors.append(f"配置文件解析错误: {str(e)}")
        
        return result
    
    def _validate_agents_config(self, agents_config: Any, result: ValidationResult):
        """验证智能体配置"""
        if not isinstance(agents_config, list):
            result.errors.append("agents 配置必须是列表格式")
            return
        
        for i, agent_config in enumerate(agents_config):
            if not isinstance(agent_config, dict):
                result.errors.append(f"智能体配置 {i} 必须是字典格式")
                continue
            
            # 验证必要字段
            required_fields = ['id', 'name', 'role']
            for field in required_fields:
                if field not in agent_config:
                    result.errors.append(f"智能体配置 {i} 缺少必要字段: {field}")
    
    def _validate_workflows_config(self, workflows_config: Any, result: ValidationResult):
        """验证工作流配置"""
        if not isinstance(workflows_config, list):
            result.errors.append("workflows 配置必须是列表格式")
            return
        
        for i, workflow_config in enumerate(workflows_config):
            if not isinstance(workflow_config, dict):
                result.errors.append(f"工作流配置 {i} 必须是字典格式")
                continue
            
            # 验证必要字段
            required_fields = ['id', 'name', 'nodes']
            for field in required_fields:
                if field not in workflow_config:
                    result.errors.append(f"工作流配置 {i} 缺少必要字段: {field}")
    
    def run_tests(
        self,
        suite: Optional[str] = None,
        pattern: Optional[str] = None,
        verbose: bool = False
    ) -> TestResult:
        """运行测试套件
        
        Args:
            suite: 测试套件名称
            pattern: 测试文件匹配模式
            verbose: 详细输出
            
        Returns:
            测试结果
        """
        result = TestResult()
        
        try:
            # 构建pytest命令
            cmd = ["python", "-m", "pytest"]
            
            if suite:
                cmd.append(f"tests/{suite}")
            elif pattern:
                cmd.append(f"tests/{pattern}")
            else:
                cmd.append("tests/")
            
            if verbose:
                cmd.append("-v")
            
            cmd.extend(["--tb=short", "--no-header"])
            
            # 运行测试
            process = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd=Path.cwd()
            )
            
            # 解析输出
            output_lines = process.stdout.split('\n')
            
            # 查找测试结果统计
            for line in output_lines:
                if "passed" in line or "failed" in line or "error" in line:
                    # 简单的结果解析
                    if "passed" in line:
                        result.success = "failed" not in line and "error" not in line
                    
                    # 提取数字
                    import re
                    numbers = re.findall(r'(\d+)', line)
                    if numbers:
                        result.tests_run = int(numbers[0])
                        if len(numbers) > 1:
                            result.failures = int(numbers[1])
                        if len(numbers) > 2:
                            result.errors = int(numbers[2])
            
            # 如果有失败，提取失败详情
            if not result.success:
                failure_lines = []
                in_failure = False
                for line in output_lines:
                    if "FAILED" in line or "ERROR" in line:
                        in_failure = True
                        failure_lines.append(line)
                    elif in_failure and line.strip():
                        failure_lines.append(line)
                    elif in_failure and not line.strip():
                        in_failure = False
                
                result.failure_details = failure_lines
                
        except Exception as e:
            result.failure_details.append(f"测试运行失败: {str(e)}")
        
        return result
    
    def list_agents(self) -> List[AgentInfo]:
        """列出当前项目的智能体
        
        Returns:
            智能体列表
        """
        agents = []
        
        # 从配置中获取智能体信息
        agents_config = self.config.get('agents', [])
        for agent_config in agents_config:
            agent = AgentInfo(
                id=agent_config.get('id', ''),
                name=agent_config.get('name', ''),
                role=agent_config.get('role', ''),
                status=agent_config.get('status', 'active')
            )
            agents.append(agent)
        
        # 如果配置中没有智能体，尝试从代码中扫描
        if not agents:
            agents = self._scan_agents_from_code()
        
        return agents
    
    def list_workflows(self) -> List[WorkflowInfo]:
        """列出当前项目的工作流
        
        Returns:
            工作流列表
        """
        workflows = []
        
        # 从配置中获取工作流信息
        workflows_config = self.config.get('workflows', [])
        for workflow_config in workflows_config:
            workflow = WorkflowInfo(
                id=workflow_config.get('id', ''),
                name=workflow_config.get('name', ''),
                node_count=len(workflow_config.get('nodes', [])),
                status=workflow_config.get('status', 'active')
            )
            workflows.append(workflow)
        
        # 如果配置中没有工作流，尝试从代码中扫描
        if not workflows:
            workflows = self._scan_workflows_from_code()
        
        return workflows
    
    def _scan_agents_from_code(self) -> List[AgentInfo]:
        """从代码中扫描智能体"""
        agents = []
        
        # 扫描examples目录
        examples_dir = Path("examples")
        if examples_dir.exists():
            for file_path in examples_dir.glob("*.py"):
                if "agent" in file_path.name.lower():
                    agent = AgentInfo(
                        id=file_path.stem,
                        name=file_path.stem.replace("_", " ").title(),
                        role="示例智能体",
                        status="example"
                    )
                    agents.append(agent)
        
        return agents
    
    def _scan_workflows_from_code(self) -> List[WorkflowInfo]:
        """从代码中扫描工作流"""
        workflows = []
        
        # 扫描examples目录
        examples_dir = Path("examples")
        if examples_dir.exists():
            for file_path in examples_dir.glob("*.py"):
                if "workflow" in file_path.name.lower() or "demo" in file_path.name.lower():
                    workflow = WorkflowInfo(
                        id=file_path.stem,
                        name=file_path.stem.replace("_", " ").title(),
                        node_count=1,  # 默认值
                        status="example"
                    )
                    workflows.append(workflow)
        
        return workflows


class AsyncAgenticXClient(AgenticXClient):
    """异步版本的AgenticX客户端"""
    
    async def arun_workflow_file(self, file_path: str) -> Any:
        """异步执行工作流文件
        
        Args:
            file_path: 工作流文件路径
            
        Returns:
            执行结果
        """
        # 在线程池中执行同步版本
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.run_workflow_file, file_path)
    
    async def avalidate_config(self, config_path: str, schema: Optional[str] = None) -> ValidationResult:
        """异步验证配置文件
        
        Args:
            config_path: 配置文件路径
            schema: 验证模式
            
        Returns:
            验证结果
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.validate_config, config_path, schema)
    
    async def arun_tests(
        self,
        suite: Optional[str] = None,
        pattern: Optional[str] = None,
        verbose: bool = False
    ) -> TestResult:
        """异步运行测试套件
        
        Args:
            suite: 测试套件名称
            pattern: 测试文件匹配模式
            verbose: 详细输出
            
        Returns:
            测试结果
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.run_tests, suite, pattern, verbose)
    
    async def alist_agents(self) -> List[AgentInfo]:
        """异步列出当前项目的智能体
        
        Returns:
            智能体列表
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.list_agents)
    
    async def alist_workflows(self) -> List[WorkflowInfo]:
        """异步列出当前项目的工作流
        
        Returns:
            工作流列表
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.list_workflows) 