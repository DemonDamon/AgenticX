#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
AgenticX 项目脚手架生成器
支持创建项目、智能体和工作流模板
"""

import os
import json
import yaml
from typing import Dict, List, Optional, Any
from pathlib import Path
from dataclasses import dataclass
from jinja2 import Template
from rich.console import Console
from rich.prompt import Prompt, Confirm

console = Console()


@dataclass
class ProjectTemplate:
    """项目模板"""
    name: str
    description: str
    type: str
    files: Dict[str, str]
    dependencies: List[str]


@dataclass
class AgentTemplate:
    """智能体模板"""
    name: str
    description: str
    type: str
    code_template: str
    config_template: str


@dataclass
class WorkflowTemplate:
    """工作流模板"""
    name: str
    description: str
    type: str
    code_template: str
    config_template: str


class ProjectScaffolder:
    """项目脚手架生成器"""
    
    def __init__(self):
        self.project_templates = self._load_project_templates()
        self.agent_templates = self._load_agent_templates()
        self.workflow_templates = self._load_workflow_templates()
    
    def _load_project_templates(self) -> Dict[str, ProjectTemplate]:
        """加载项目模板"""
        templates = {}
        
        # 基础项目模板
        templates['basic'] = ProjectTemplate(
            name="basic",
            description="基础AgenticX项目模板",
            type="project",
            files={
                "main.py": self._get_basic_main_template(),
                "config.yaml": self._get_basic_config_template(),
                "requirements.txt": self._get_basic_requirements_template(),
                "README.md": self._get_basic_readme_template(),
                ".gitignore": self._get_gitignore_template(),
                ".env.example": self._get_env_example_template(),
                "agents/__init__.py": "",
                "workflows/__init__.py": "",
                "tools/__init__.py": "",
                "tests/__init__.py": "",
                "tests/test_basic.py": self._get_basic_test_template(),
            },
            dependencies=["agenticx", "pydantic", "typer", "rich"]
        )
        
        # 多智能体项目模板
        templates['multi_agent'] = ProjectTemplate(
            name="multi_agent",
            description="多智能体协作项目模板",
            type="project",
            files={
                "main.py": self._get_multi_agent_main_template(),
                "config.yaml": self._get_multi_agent_config_template(),
                "requirements.txt": self._get_multi_agent_requirements_template(),
                "README.md": self._get_multi_agent_readme_template(),
                ".gitignore": self._get_gitignore_template(),
                ".env.example": self._get_env_example_template(),
                "agents/__init__.py": "",
                "agents/coordinator.py": self._get_coordinator_agent_template(),
                "agents/worker.py": self._get_worker_agent_template(),
                "workflows/__init__.py": "",
                "workflows/collaboration.py": self._get_collaboration_workflow_template(),
                "tools/__init__.py": "",
                "tools/communication.py": self._get_communication_tool_template(),
                "tests/__init__.py": "",
                "tests/test_multi_agent.py": self._get_multi_agent_test_template(),
            },
            dependencies=["agenticx", "pydantic", "typer", "rich", "fastapi", "uvicorn"]
        )
        
        # 企业级项目模板
        templates['enterprise'] = ProjectTemplate(
            name="enterprise",
            description="企业级AgenticX项目模板",
            type="project",
            files={
                "main.py": self._get_enterprise_main_template(),
                "config.yaml": self._get_enterprise_config_template(),
                "requirements.txt": self._get_enterprise_requirements_template(),
                "README.md": self._get_enterprise_readme_template(),
                ".gitignore": self._get_gitignore_template(),
                ".env.example": self._get_env_example_template(),
                "Dockerfile": self._get_dockerfile_template(),
                "docker-compose.yml": self._get_docker_compose_template(),
                "agents/__init__.py": "",
                "workflows/__init__.py": "",
                "tools/__init__.py": "",
                "monitoring/__init__.py": "",
                "monitoring/metrics.py": self._get_metrics_template(),
                "security/__init__.py": "",
                "security/auth.py": self._get_auth_template(),
                "tests/__init__.py": "",
                "tests/test_enterprise.py": self._get_enterprise_test_template(),
            },
            dependencies=[
                "agenticx", "pydantic", "typer", "rich", "fastapi", "uvicorn",
                "prometheus-client", "opentelemetry-api", "opentelemetry-sdk",
                "redis", "celery", "gunicorn"
            ]
        )
        
        return templates
    
    def _load_agent_templates(self) -> Dict[str, AgentTemplate]:
        """加载智能体模板"""
        templates = {}
        
        templates['basic'] = AgentTemplate(
            name="basic",
            description="基础智能体模板",
            type="agent",
            code_template=self._get_basic_agent_code_template(),
            config_template=self._get_basic_agent_config_template()
        )
        
        templates['researcher'] = AgentTemplate(
            name="researcher",
            description="研究员智能体模板",
            type="agent",
            code_template=self._get_researcher_agent_code_template(),
            config_template=self._get_researcher_agent_config_template()
        )
        
        templates['analyst'] = AgentTemplate(
            name="analyst",
            description="分析师智能体模板",
            type="agent",
            code_template=self._get_analyst_agent_code_template(),
            config_template=self._get_analyst_agent_config_template()
        )
        
        templates['writer'] = AgentTemplate(
            name="writer",
            description="写作者智能体模板",
            type="agent",
            code_template=self._get_writer_agent_code_template(),
            config_template=self._get_writer_agent_config_template()
        )
        
        return templates
    
    def _load_workflow_templates(self) -> Dict[str, WorkflowTemplate]:
        """加载工作流模板"""
        templates = {}
        
        templates['sequential'] = WorkflowTemplate(
            name="sequential",
            description="顺序工作流模板",
            type="workflow",
            code_template=self._get_sequential_workflow_code_template(),
            config_template=self._get_sequential_workflow_config_template()
        )
        
        templates['parallel'] = WorkflowTemplate(
            name="parallel",
            description="并行工作流模板",
            type="workflow",
            code_template=self._get_parallel_workflow_code_template(),
            config_template=self._get_parallel_workflow_config_template()
        )
        
        templates['conditional'] = WorkflowTemplate(
            name="conditional",
            description="条件工作流模板",
            type="workflow",
            code_template=self._get_conditional_workflow_code_template(),
            config_template=self._get_conditional_workflow_config_template()
        )
        
        return templates
    
    def create_project(self, name: str, template: str = "basic", directory: Optional[str] = None) -> str:
        """创建新项目
        
        Args:
            name: 项目名称
            template: 项目模板
            directory: 项目目录
            
        Returns:
            项目路径
        """
        if template not in self.project_templates:
            raise ValueError(f"未知的项目模板: {template}")
        
        # 确定项目目录
        if directory:
            project_dir = Path(directory) / name
        else:
            project_dir = Path(name)
        
        # 检查目录是否存在
        if project_dir.exists():
            if not Confirm.ask(f"目录 {project_dir} 已存在，是否覆盖？"):
                raise ValueError("项目创建被取消")
        
        # 创建项目目录
        project_dir.mkdir(parents=True, exist_ok=True)
        
        # 获取模板
        template_obj = self.project_templates[template]
        
        # 创建文件
        for file_path, content in template_obj.files.items():
            full_path = project_dir / file_path
            full_path.parent.mkdir(parents=True, exist_ok=True)
            
            # 渲染模板
            if content:
                template_engine = Template(content)
                rendered_content = template_engine.render(
                    project_name=name,
                    project_description=f"{name} - AgenticX项目",
                    dependencies=template_obj.dependencies
                )
                full_path.write_text(rendered_content, encoding='utf-8')
            else:
                full_path.touch()
        
        return str(project_dir)
    
    def create_agent(
        self,
        name: str,
        role: str = "Assistant",
        template: str = "basic",
        interactive: bool = False
    ) -> str:
        """创建新的智能体
        
        Args:
            name: 智能体名称
            role: 智能体角色
            template: 智能体模板
            interactive: 交互式创建
            
        Returns:
            智能体文件路径
        """
        if template not in self.agent_templates:
            raise ValueError(f"未知的智能体模板: {template}")
        
        # 交互式输入
        if interactive:
            name = Prompt.ask("智能体名称", default=name)
            role = Prompt.ask("智能体角色", default=role)
            goal = Prompt.ask("智能体目标", default="完成用户指定的任务")
            backstory = Prompt.ask("智能体背景", default="我是一个专业的AI助手")
        else:
            goal = "完成用户指定的任务"
            backstory = "我是一个专业的AI助手"
        
        # 创建智能体目录
        agents_dir = Path("agents")
        agents_dir.mkdir(exist_ok=True)
        
        # 生成文件名
        file_name = name.lower().replace(" ", "_") + ".py"
        agent_file = agents_dir / file_name
        
        # 获取模板
        template_obj = self.agent_templates[template]
        
        # 渲染代码模板
        code_template = Template(template_obj.code_template)
        code_content = code_template.render(
            agent_name=name,
            agent_role=role,
            agent_goal=goal,
            agent_backstory=backstory,
            agent_id=name.lower().replace(" ", "_")
        )
        
        # 写入文件
        agent_file.write_text(code_content, encoding='utf-8')
        
        return str(agent_file)
    
    def create_workflow(
        self,
        name: str,
        template: str = "sequential",
        interactive: bool = False
    ) -> str:
        """创建新的工作流
        
        Args:
            name: 工作流名称
            template: 工作流模板
            interactive: 交互式创建
            
        Returns:
            工作流文件路径
        """
        if template not in self.workflow_templates:
            raise ValueError(f"未知的工作流模板: {template}")
        
        # 交互式输入
        if interactive:
            name = Prompt.ask("工作流名称", default=name)
            description = Prompt.ask("工作流描述", default="自动化工作流")
        else:
            description = "自动化工作流"
        
        # 创建工作流目录
        workflows_dir = Path("workflows")
        workflows_dir.mkdir(exist_ok=True)
        
        # 生成文件名
        file_name = name.lower().replace(" ", "_") + ".py"
        workflow_file = workflows_dir / file_name
        
        # 获取模板
        template_obj = self.workflow_templates[template]
        
        # 渲染代码模板
        code_template = Template(template_obj.code_template)
        code_content = code_template.render(
            workflow_name=name,
            workflow_description=description,
            workflow_id=name.lower().replace(" ", "_")
        )
        
        # 写入文件
        workflow_file.write_text(code_content, encoding='utf-8')
        
        return str(workflow_file)
    
    def list_templates(self) -> List[ProjectTemplate]:
        """列出可用的项目模板
        
        Returns:
            模板列表
        """
        return list(self.project_templates.values())
    
    def list_agent_templates(self) -> List[AgentTemplate]:
        """列出可用的智能体模板
        
        Returns:
            智能体模板列表
        """
        return list(self.agent_templates.values())
    
    def list_workflow_templates(self) -> List[WorkflowTemplate]:
        """列出可用的工作流模板
        
        Returns:
            工作流模板列表
        """
        return list(self.workflow_templates.values())
    
    # === 模板内容定义 ===
    
    def _get_basic_main_template(self) -> str:
        return '''#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
{{ project_name }} - AgenticX项目
"""

import os
from agenticx import Agent, Task, AgentExecutor
from agenticx.llms import OpenAIProvider


def main():
    """主函数"""
    # 创建智能体
    agent = Agent(
        id="main_agent",
        name="主智能体",
        role="助手",
        goal="帮助用户完成任务",
        backstory="我是一个专业的AI助手",
        organization_id="default"
    )
    
    # 创建任务
    task = Task(
        id="main_task",
        description="请介绍一下自己",
        expected_output="简洁的自我介绍"
    )
    
    # 配置LLM
    llm = OpenAIProvider(
        model="gpt-4o-mini",
        api_key=os.getenv("OPENAI_API_KEY")
    )
    
    # 执行任务
    executor = AgentExecutor(llm_provider=llm)
    result = executor.run(agent, task)
    
    print(f"执行结果: {result}")


if __name__ == "__main__":
    main()
'''
    
    def _get_basic_config_template(self) -> str:
        return '''# {{ project_name }} 配置文件

# LLM配置
llm:
  provider: openai
  model: gpt-4o-mini
  api_key: ${OPENAI_API_KEY}
  base_url: ${OPENAI_API_BASE}  # 支持代理设置
  temperature: 0.7
  max_tokens: 1000

# 智能体配置
agents:
  - id: main_agent
    name: 主智能体
    role: 助手
    goal: 帮助用户完成任务
    backstory: 我是一个专业的AI助手
    tools: []

# 工作流配置
workflows:
  - id: main_workflow
    name: 主工作流
    nodes:
      - id: start
        type: agent
        agent_id: main_agent
    edges: []

# 监控配置
monitoring:
  enabled: true
  metrics:
    - execution_time
    - token_usage
    - success_rate
'''
    
    def _get_basic_requirements_template(self) -> str:
        return '''# {{ project_name }} 依赖包
{% for dep in dependencies %}
{{ dep }}
{% endfor %}
'''
    
    def _get_basic_readme_template(self) -> str:
        return '''# {{ project_name }}

{{ project_description }}

## 安装

```bash
pip install -r requirements.txt
```

## 运行

```bash
python main.py
```

## 配置

1. 复制 `config.yaml` 文件
2. 设置你的API密钥
3. 根据需要调整配置

## 项目结构

```
{{ project_name }}/
├── main.py              # 主程序
├── config.yaml          # 配置文件
├── requirements.txt     # 依赖包
├── agents/             # 智能体目录
├── workflows/          # 工作流目录
├── tools/              # 工具目录
└── tests/              # 测试目录
```

## 使用说明

这是一个基础的AgenticX项目模板，包含：
- 基础智能体配置
- 简单任务执行
- 配置文件管理
- 测试框架

你可以根据需要扩展和修改。
'''
    
    def _get_gitignore_template(self) -> str:
        return '''# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
build/
develop-eggs/
dist/
downloads/
eggs/
.eggs/
lib/
lib64/
parts/
sdist/
var/
wheels/
*.egg-info/
.installed.cfg
*.egg
MANIFEST

# PyInstaller
*.manifest
*.spec

# Installer logs
pip-log.txt
pip-delete-this-directory.txt

# Unit test / coverage reports
htmlcov/
.tox/
.nox/
.coverage
.coverage.*
.cache
nosetests.xml
coverage.xml
*.cover
.hypothesis/
.pytest_cache/

# Translations
*.mo
*.pot

# Django stuff:
*.log
local_settings.py
db.sqlite3

# Flask stuff:
instance/
.webassets-cache

# Scrapy stuff:
.scrapy

# Sphinx documentation
docs/_build/

# PyBuilder
target/

# Jupyter Notebook
.ipynb_checkpoints

# IPython
profile_default/
ipython_config.py

# pyenv
.python-version

# celery beat schedule file
celerybeat-schedule

# SageMath parsed files
*.sage.py

# Environments
.env
.venv
env/
venv/
ENV/
env.bak/
venv.bak/

# Spyder project settings
.spyderproject
.spyproject

# Rope project settings
.ropeproject

# mkdocs documentation
/site

# mypy
.mypy_cache/
.dmypy.json
dmypy.json

# Pyre type checker
.pyre/

# AgenticX specific
*.log
logs/
monitoring/
.agenticx/
'''
    
    def _get_basic_test_template(self) -> str:
        return '''#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
{{ project_name }} 基础测试
"""

import pytest
from agenticx import Agent, Task


def test_agent_creation():
    """测试智能体创建"""
    agent = Agent(
        id="test_agent",
        name="测试智能体",
        role="测试助手",
        goal="执行测试任务",
        backstory="我是一个用于测试的智能体",
        organization_id="test"
    )
    
    assert agent.id == "test_agent"
    assert agent.name == "测试智能体"
    assert agent.role == "测试助手"


def test_task_creation():
    """测试任务创建"""
    task = Task(
        id="test_task",
        description="这是一个测试任务",
        expected_output="测试结果"
    )
    
    assert task.id == "test_task"
    assert task.description == "这是一个测试任务"
    assert task.expected_output == "测试结果"


if __name__ == "__main__":
    pytest.main([__file__])
'''
    
    def _get_basic_agent_code_template(self) -> str:
        return '''#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
{{ agent_name }} 智能体
"""

from agenticx import Agent, Task, AgentExecutor
from agenticx.llms import OpenAIProvider
from agenticx.tools import tool


@tool()
def {{ agent_id }}_tool(input_text: str) -> str:
    """{{ agent_name }}专用工具"""
    return f"处理结果: {input_text}"


class {{ agent_name.replace(" ", "") }}Agent:
    """{{ agent_name }}智能体类"""
    
    def __init__(self, llm_provider):
        self.agent = Agent(
            id="{{ agent_id }}",
            name="{{ agent_name }}",
            role="{{ agent_role }}",
            goal="{{ agent_goal }}",
            backstory="{{ agent_backstory }}",
            organization_id="default"
        )
        self.executor = AgentExecutor(llm_provider=llm_provider)
    
    def run(self, task_description: str) -> str:
        """运行任务"""
        task = Task(
            id=f"{{ agent_id }}_task",
            description=task_description,
            expected_output="完成的任务结果"
        )
        
        result = self.executor.run(self.agent, task)
        return result.get('result', str(result))


def main():
    """主函数"""
    # 创建LLM提供者
    llm = OpenAIProvider(model="gpt-4o-mini")
    
    # 创建智能体
    agent = {{ agent_name.replace(" ", "") }}Agent(llm)
    
    # 运行任务
    result = agent.run("请介绍一下自己")
    print(f"执行结果: {result}")


if __name__ == "__main__":
    main()
'''
    
    def _get_basic_agent_config_template(self) -> str:
        return '''# {{ agent_name }} 配置
id: {{ agent_id }}
name: {{ agent_name }}
role: {{ agent_role }}
goal: {{ agent_goal }}
backstory: {{ agent_backstory }}
tools:
  - {{ agent_id }}_tool
'''
    
    def _get_sequential_workflow_code_template(self) -> str:
        return '''#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
{{ workflow_name }} 顺序工作流
"""

from agenticx import Agent, Task, Workflow, WorkflowGraph
from agenticx.core.workflow_engine import WorkflowEngine
from agenticx.llms import OpenAIProvider


def create_{{ workflow_id }}_workflow() -> Workflow:
    """创建{{ workflow_name }}工作流"""
    
    # 创建工作流图
    graph = WorkflowGraph()
    
    # 添加节点
    graph.add_node("step1", lambda x: f"步骤1处理: {x}")
    graph.add_node("step2", lambda x: f"步骤2处理: {x}")
    graph.add_node("step3", lambda x: f"步骤3处理: {x}")
    
    # 添加边（顺序执行）
    graph.add_edge("step1", "step2")
    graph.add_edge("step2", "step3")
    
    # 创建工作流
    workflow = Workflow(
        id="{{ workflow_id }}",
        name="{{ workflow_name }}",
        version="1.0.0",
        description="{{ workflow_description }}",
        graph=graph,
        organization_id="default"
    )
    
    return workflow


def main():
    """主函数"""
    # 创建工作流
    workflow = create_{{ workflow_id }}_workflow()
    
    # 创建工作流引擎
    engine = WorkflowEngine()
    
    # 执行工作流
    result = engine.run(workflow, initial_input="开始处理")
    
    print(f"工作流执行结果: {result}")


if __name__ == "__main__":
    main()
'''
    
    def _get_sequential_workflow_config_template(self) -> str:
        return '''# {{ workflow_name }} 配置
id: {{ workflow_id }}
name: {{ workflow_name }}
description: {{ workflow_description }}
type: sequential
nodes:
  - id: step1
    type: function
    name: 步骤1
  - id: step2
    type: function
    name: 步骤2
  - id: step3
    type: function
    name: 步骤3
edges:
  - from: step1
    to: step2
  - from: step2
    to: step3
'''
    
    # 其他模板方法的占位符（为了简洁，这里只展示部分）
    def _get_multi_agent_main_template(self) -> str:
        return "# 多智能体项目主程序模板"
    
    def _get_multi_agent_config_template(self) -> str:
        return '''# {{ project_name }} 多智能体配置文件

# LLM配置
llm:
  provider: openai
  model: gpt-4o-mini
  api_key: ${OPENAI_API_KEY}
  base_url: ${OPENAI_API_BASE}  # 支持代理设置
  temperature: 0.7
  max_tokens: 2000

# 智能体配置
agents:
  - id: coordinator_agent
    name: 协调器智能体
    role: 协调器
    goal: 协调多个智能体完成复杂任务
    backstory: 我是一个专业的任务协调器
    tools: []
  
  - id: worker_agent_1
    name: 工作者智能体1
    role: 专业工作者
    goal: 执行具体任务
    backstory: 我是一个专业的任务执行者
    tools: []
  
  - id: worker_agent_2
    name: 工作者智能体2
    role: 专业工作者
    goal: 执行具体任务
    backstory: 我是一个专业的任务执行者
    tools: []

# 工作流配置
workflows:
  - id: multi_agent_workflow
    name: 多智能体协作工作流
    nodes:
      - id: coordinator
        type: agent
        agent_id: coordinator_agent
      - id: worker1
        type: agent
        agent_id: worker_agent_1
      - id: worker2
        type: agent
        agent_id: worker_agent_2
    edges:
      - from: coordinator
        to: worker1
      - from: coordinator
        to: worker2

# 监控配置
monitoring:
  enabled: true
  metrics:
    - execution_time
    - token_usage
    - success_rate
    - agent_performance
'''
    
    def _get_multi_agent_requirements_template(self) -> str:
        return "# 多智能体项目依赖模板"
    
    def _get_multi_agent_readme_template(self) -> str:
        return "# 多智能体项目README模板"
    
    def _get_coordinator_agent_template(self) -> str:
        return "# 协调器智能体模板"
    
    def _get_worker_agent_template(self) -> str:
        return "# 工作者智能体模板"
    
    def _get_collaboration_workflow_template(self) -> str:
        return "# 协作工作流模板"
    
    def _get_communication_tool_template(self) -> str:
        return "# 通信工具模板"
    
    def _get_multi_agent_test_template(self) -> str:
        return "# 多智能体测试模板"
    
    def _get_enterprise_main_template(self) -> str:
        return "# 企业级项目主程序模板"
    
    def _get_enterprise_config_template(self) -> str:
        return '''# {{ project_name }} 企业级配置文件

# LLM配置
llm:
  provider: openai
  model: gpt-4o-mini
  api_key: ${OPENAI_API_KEY}
  base_url: ${OPENAI_API_BASE}  # 支持代理设置
  temperature: 0.7
  max_tokens: 2000

# 企业级功能配置
enterprise:
  authentication:
    enabled: true
    type: jwt
    secret: ${JWT_SECRET}
  
  authorization:
    enabled: true
    roles:
      - admin
      - user
      - guest
  
  rate_limiting:
    enabled: true
    requests_per_minute: 100
  
  caching:
    enabled: true
    type: redis
    url: ${REDIS_URL}

# 智能体配置
agents:
  - id: enterprise_agent
    name: 企业级智能体
    role: 企业助手
    goal: 为企业用户提供专业服务
    backstory: 我是一个专业的企业级AI助手
    tools: []

# 工作流配置
workflows:
  - id: enterprise_workflow
    name: 企业级工作流
    nodes:
      - id: auth_check
        type: auth
      - id: main_agent
        type: agent
        agent_id: enterprise_agent
    edges:
      - from: auth_check
        to: main_agent

# 监控配置
monitoring:
  enabled: true
  metrics:
    - execution_time
    - token_usage
    - success_rate
    - user_satisfaction
    - error_rate
  
  logging:
    level: INFO
    format: json
    destination: file
    file_path: logs/enterprise.log
  
  alerting:
    enabled: true
    thresholds:
      error_rate: 0.05
      response_time: 5000

# 数据库配置
database:
  type: postgresql
  host: ${DB_HOST}
  port: ${DB_PORT}
  name: ${DB_NAME}
  user: ${DB_USER}
  password: ${DB_PASSWORD}
'''
    
    def _get_enterprise_requirements_template(self) -> str:
        return "# 企业级项目依赖模板"
    
    def _get_enterprise_readme_template(self) -> str:
        return "# 企业级项目README模板"
    
    def _get_dockerfile_template(self) -> str:
        return "# Dockerfile模板"
    
    def _get_docker_compose_template(self) -> str:
        return "# Docker Compose模板"
    
    def _get_metrics_template(self) -> str:
        return "# 监控指标模板"
    
    def _get_auth_template(self) -> str:
        return "# 认证模板"
    
    def _get_enterprise_test_template(self) -> str:
        return "# 企业级测试模板"
    
    def _get_researcher_agent_code_template(self) -> str:
        return "# 研究员智能体代码模板"
    
    def _get_researcher_agent_config_template(self) -> str:
        return "# 研究员智能体配置模板"
    
    def _get_analyst_agent_code_template(self) -> str:
        return "# 分析师智能体代码模板"
    
    def _get_analyst_agent_config_template(self) -> str:
        return "# 分析师智能体配置模板"
    
    def _get_writer_agent_code_template(self) -> str:
        return "# 写作者智能体代码模板"
    
    def _get_writer_agent_config_template(self) -> str:
        return "# 写作者智能体配置模板"
    
    def _get_parallel_workflow_code_template(self) -> str:
        return "# 并行工作流代码模板"
    
    def _get_parallel_workflow_config_template(self) -> str:
        return "# 并行工作流配置模板"
    
    def _get_conditional_workflow_code_template(self) -> str:
        return "# 条件工作流代码模板"
    
    def _get_conditional_workflow_config_template(self) -> str:
        return "# 条件工作流配置模板"
    
    def _get_env_example_template(self) -> str:
        """获取环境变量示例模板"""
        template_path = Path(__file__).parent / "env_template.txt"
        return template_path.read_text(encoding='utf-8')