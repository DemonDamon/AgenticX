#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
AgenticX 部署管理器
支持Docker、Kubernetes等多种部署方式
"""

import os
import json
import shutil
import subprocess
from typing import Dict, List, Optional, Any
from pathlib import Path
from datetime import datetime
import yaml

from rich.console import Console

console = Console()


class DeployManager:
    """部署管理器"""
    
    def __init__(self):
        self.supported_platforms = ["docker", "kubernetes", "compose", "serverless"]
        self.temp_dir = Path(".agenticx_deploy")
    
    def prepare_deployment(
        self,
        target: str,
        platform: str = "docker",
        config: Optional[str] = None
    ) -> str:
        """准备部署包"""
        if platform not in self.supported_platforms:
            raise ValueError(f"不支持的平台: {platform}")
        
        console.print(f"[bold blue]准备部署:[/bold blue] {target} ({platform})")
        
        target_path = Path(target)
        target_path.mkdir(parents=True, exist_ok=True)
        
        # 根据平台准备部署文件
        if platform == "docker":
            return self._prepare_docker_deployment(target_path, config)
        elif platform == "kubernetes":
            return self._prepare_kubernetes_deployment(target_path, config)
        elif platform == "compose":
            return self._prepare_compose_deployment(target_path, config)
        elif platform == "serverless":
            return self._prepare_serverless_deployment(target_path, config)
        
        return str(target_path)
    
    def _prepare_docker_deployment(self, target_path: Path, config: Optional[str]) -> str:
        """准备Docker部署"""
        console.print("[blue]准备Docker部署文件...[/blue]")
        
        # 创建Dockerfile
        dockerfile_content = self._get_dockerfile_template()
        dockerfile_path = target_path / "Dockerfile"
        dockerfile_path.write_text(dockerfile_content, encoding='utf-8')
        
        # 创建requirements.txt
        requirements_content = self._get_requirements_template()
        requirements_path = target_path / "requirements.txt"
        requirements_path.write_text(requirements_content, encoding='utf-8')
        
        # 创建启动脚本
        start_script_content = self._get_start_script_template()
        start_script_path = target_path / "start.sh"
        start_script_path.write_text(start_script_content, encoding='utf-8')
        start_script_path.chmod(0o755)
        
        # 创建配置文件
        config_content = self._get_config_template()
        config_path = target_path / "config.yaml"
        config_path.write_text(config_content, encoding='utf-8')
        
        console.print(f"[green]Docker部署文件准备完成:[/green] {dockerfile_path}")
        return str(target_path)
    
    def _prepare_kubernetes_deployment(self, target_path: Path, config: Optional[str]) -> str:
        """准备Kubernetes部署"""
        console.print("[blue]准备Kubernetes部署文件...[/blue]")
        
        # 创建k8s目录
        k8s_dir = target_path / "k8s"
        k8s_dir.mkdir(exist_ok=True)
        
        # 创建Deployment
        deployment_content = self._get_k8s_deployment_template()
        deployment_path = k8s_dir / "deployment.yaml"
        deployment_path.write_text(deployment_content, encoding='utf-8')
        
        # 创建Service
        service_content = self._get_k8s_service_template()
        service_path = k8s_dir / "service.yaml"
        service_path.write_text(service_content, encoding='utf-8')
        
        # 创建ConfigMap
        configmap_content = self._get_k8s_configmap_template()
        configmap_path = k8s_dir / "configmap.yaml"
        configmap_path.write_text(configmap_content, encoding='utf-8')
        
        # 创建部署脚本
        deploy_script_content = self._get_k8s_deploy_script_template()
        deploy_script_path = target_path / "deploy.sh"
        deploy_script_path.write_text(deploy_script_content, encoding='utf-8')
        deploy_script_path.chmod(0o755)
        
        console.print(f"[green]Kubernetes部署文件准备完成:[/green] {k8s_dir}")
        return str(target_path)
    
    def _prepare_compose_deployment(self, target_path: Path, config: Optional[str]) -> str:
        """准备Docker Compose部署"""
        console.print("[blue]准备Docker Compose部署文件...[/blue]")
        
        # 创建docker-compose.yml
        compose_content = self._get_compose_template()
        compose_path = target_path / "docker-compose.yml"
        compose_path.write_text(compose_content, encoding='utf-8')
        
        # 创建环境配置
        env_content = self._get_env_template()
        env_path = target_path / ".env"
        env_path.write_text(env_content, encoding='utf-8')
        
        # 创建启动脚本
        start_script_content = self._get_compose_start_script_template()
        start_script_path = target_path / "start.sh"
        start_script_path.write_text(start_script_content, encoding='utf-8')
        start_script_path.chmod(0o755)
        
        console.print(f"[green]Docker Compose部署文件准备完成:[/green] {compose_path}")
        return str(target_path)
    
    def _prepare_serverless_deployment(self, target_path: Path, config: Optional[str]) -> str:
        """准备Serverless部署"""
        console.print("[blue]准备Serverless部署文件...[/blue]")
        
        # 创建serverless.yml
        serverless_content = self._get_serverless_template()
        serverless_path = target_path / "serverless.yml"
        serverless_path.write_text(serverless_content, encoding='utf-8')
        
        # 创建Lambda函数
        lambda_content = self._get_lambda_template()
        lambda_path = target_path / "handler.py"
        lambda_path.write_text(lambda_content, encoding='utf-8')
        
        console.print(f"[green]Serverless部署文件准备完成:[/green] {serverless_path}")
        return str(target_path)
    
    def deploy_docker(
        self,
        image_name: str = "agenticx-app",
        tag: str = "latest",
        push: bool = False
    ) -> str:
        """部署到Docker"""
        console.print(f"[bold blue]Docker部署:[/bold blue] {image_name}:{tag}")
        
        try:
            # 构建镜像
            build_cmd = ["docker", "build", "-t", f"{image_name}:{tag}", "."]
            result = subprocess.run(build_cmd, capture_output=True, text=True)
            
            if result.returncode != 0:
                raise Exception(f"Docker构建失败: {result.stderr}")
            
            console.print(f"[green]Docker镜像构建成功:[/green] {image_name}:{tag}")
            
            # 推送到仓库
            if push:
                push_cmd = ["docker", "push", f"{image_name}:{tag}"]
                result = subprocess.run(push_cmd, capture_output=True, text=True)
                
                if result.returncode != 0:
                    raise Exception(f"Docker推送失败: {result.stderr}")
                
                console.print(f"[green]Docker镜像推送成功:[/green] {image_name}:{tag}")
            
            # 获取镜像ID
            inspect_cmd = ["docker", "inspect", "--format={{.Id}}", f"{image_name}:{tag}"]
            result = subprocess.run(inspect_cmd, capture_output=True, text=True)
            
            if result.returncode == 0:
                image_id = result.stdout.strip()
                return image_id
            else:
                return f"{image_name}:{tag}"
                
        except Exception as e:
            console.print(f"[red]Docker部署失败:[/red] {e}")
            raise
    
    def deploy_kubernetes(self, namespace: str = "default") -> str:
        """部署到Kubernetes"""
        console.print(f"[bold blue]Kubernetes部署:[/bold blue] namespace={namespace}")
        
        try:
            # 应用配置
            apply_cmd = ["kubectl", "apply", "-f", "k8s/", "-n", namespace]
            result = subprocess.run(apply_cmd, capture_output=True, text=True)
            
            if result.returncode != 0:
                raise Exception(f"Kubernetes部署失败: {result.stderr}")
            
            console.print(f"[green]Kubernetes部署成功:[/green] namespace={namespace}")
            return namespace
            
        except Exception as e:
            console.print(f"[red]Kubernetes部署失败:[/red] {e}")
            raise
    
    def deploy_compose(self) -> str:
        """部署Docker Compose"""
        console.print("[bold blue]Docker Compose部署[/bold blue]")
        
        try:
            # 启动服务
            up_cmd = ["docker-compose", "up", "-d"]
            result = subprocess.run(up_cmd, capture_output=True, text=True)
            
            if result.returncode != 0:
                raise Exception(f"Docker Compose部署失败: {result.stderr}")
            
            console.print("[green]Docker Compose部署成功[/green]")
            return "compose"
            
        except Exception as e:
            console.print(f"[red]Docker Compose部署失败:[/red] {e}")
            raise
    
    def get_deployment_status(self, platform: str, target: str) -> Dict[str, Any]:
        """获取部署状态"""
        console.print(f"[blue]获取部署状态:[/blue] {platform} - {target}")
        
        if platform == "docker":
            return self._get_docker_status(target)
        elif platform == "kubernetes":
            return self._get_kubernetes_status(target)
        elif platform == "compose":
            return self._get_compose_status()
        
        return {"status": "unknown", "platform": platform, "target": target}
    
    def _get_docker_status(self, image_name: str) -> Dict[str, Any]:
        """获取Docker状态"""
        try:
            # 检查镜像是否存在
            inspect_cmd = ["docker", "inspect", image_name]
            result = subprocess.run(inspect_cmd, capture_output=True, text=True)
            
            if result.returncode == 0:
                return {"status": "ready", "platform": "docker", "image": image_name}
            else:
                return {"status": "not_found", "platform": "docker", "image": image_name}
                
        except Exception as e:
            return {"status": "error", "platform": "docker", "error": str(e)}
    
    def _get_kubernetes_status(self, namespace: str) -> Dict[str, Any]:
        """获取Kubernetes状态"""
        try:
            # 检查Pod状态
            get_cmd = ["kubectl", "get", "pods", "-n", namespace]
            result = subprocess.run(get_cmd, capture_output=True, text=True)
            
            if result.returncode == 0:
                return {"status": "running", "platform": "kubernetes", "namespace": namespace}
            else:
                return {"status": "error", "platform": "kubernetes", "error": result.stderr}
                
        except Exception as e:
            return {"status": "error", "platform": "kubernetes", "error": str(e)}
    
    def _get_compose_status(self) -> Dict[str, Any]:
        """获取Docker Compose状态"""
        try:
            # 检查服务状态
            ps_cmd = ["docker-compose", "ps"]
            result = subprocess.run(ps_cmd, capture_output=True, text=True)
            
            if result.returncode == 0:
                return {"status": "running", "platform": "compose", "services": result.stdout}
            else:
                return {"status": "error", "platform": "compose", "error": result.stderr}
                
        except Exception as e:
            return {"status": "error", "platform": "compose", "error": str(e)}
    
    # === 模板定义 ===
    
    def _get_dockerfile_template(self) -> str:
        """获取Dockerfile模板"""
        return """FROM python:3.10-slim

WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y \\
    gcc \\
    g++ \\
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY requirements.txt .

# 安装Python依赖
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY . .

# 暴露端口
EXPOSE 8000

# 启动脚本
CMD ["./start.sh"]
"""
    
    def _get_requirements_template(self) -> str:
        """获取requirements.txt模板"""
        return """agenticx
fastapi
uvicorn
pydantic
typer
rich
"""
    
    def _get_start_script_template(self) -> str:
        """获取启动脚本模板"""
        return """#!/bin/bash
set -e

echo "Starting AgenticX application..."

# 设置环境变量
export PYTHONPATH=/app:$PYTHONPATH

# 启动应用
exec uvicorn main:app --host 0.0.0.0 --port 8000
"""
    
    def _get_config_template(self) -> str:
        """获取配置文件模板"""
        return """# AgenticX 配置文件

# 应用配置
app:
  name: agenticx-app
  version: 1.0.0
  debug: false

# 服务器配置
server:
  host: 0.0.0.0
  port: 8000
  workers: 1

# LLM配置 (支持多种provider)
llm:
  provider: ${LLM_PROVIDER:-openai}
  model: ${LLM_MODEL:-gpt-4o-mini}
  api_key: ${LLM_API_KEY:-${OPENAI_API_KEY}}
  base_url: ${LLM_BASE_URL:-${OPENAI_API_BASE}}
  temperature: 0.7
  max_tokens: 1000

# 数据库配置
database:
  url: ${DATABASE_URL}
  
# 日志配置
logging:
  level: INFO
  format: json
"""
    
    def _get_k8s_deployment_template(self) -> str:
        """获取Kubernetes Deployment模板"""
        return """apiVersion: apps/v1
kind: Deployment
metadata:
  name: agenticx-app
  labels:
    app: agenticx-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: agenticx-app
  template:
    metadata:
      labels:
        app: agenticx-app
    spec:
      containers:
      - name: agenticx-app
        image: agenticx-app:latest
        ports:
        - containerPort: 8000
        env:
        # LLM Provider 配置
        - name: LLM_PROVIDER
          valueFrom:
            configMapKeyRef:
              name: agenticx-config
              key: llm-provider
        - name: LLM_MODEL
          valueFrom:
            configMapKeyRef:
              name: agenticx-config
              key: llm-model
        # OpenAI
        - name: OPENAI_API_KEY
          valueFrom:
            secretKeyRef:
              name: agenticx-secrets
              key: openai-api-key
        - name: OPENAI_API_BASE
          valueFrom:
            configMapKeyRef:
              name: agenticx-config
              key: openai-api-base
        # DeepSeek
        - name: DEEPSEEK_API_KEY
          valueFrom:
            secretKeyRef:
              name: agenticx-secrets
              key: deepseek-api-key
        - name: DEEPSEEK_API_BASE
          valueFrom:
            configMapKeyRef:
              name: agenticx-config
              key: deepseek-api-base
        # Anthropic
        - name: ANTHROPIC_API_KEY
          valueFrom:
            secretKeyRef:
              name: agenticx-secrets
              key: anthropic-api-key
        - name: ANTHROPIC_API_BASE
          valueFrom:
            configMapKeyRef:
              name: agenticx-config
              key: anthropic-api-base
        # 数据库
        - name: DATABASE_URL
          valueFrom:
            configMapKeyRef:
              name: agenticx-config
              key: database-url
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 5
          periodSeconds: 5
"""
    
    def _get_k8s_service_template(self) -> str:
        """获取Kubernetes Service模板"""
        return """apiVersion: v1
kind: Service
metadata:
  name: agenticx-service
spec:
  selector:
    app: agenticx-app
  ports:
    - protocol: TCP
      port: 80
      targetPort: 8000
  type: LoadBalancer
"""
    
    def _get_k8s_configmap_template(self) -> str:
        """获取Kubernetes ConfigMap模板"""
        return """apiVersion: v1
kind: ConfigMap
metadata:
  name: agenticx-config
data:
  # LLM Provider 配置
  llm-provider: "openai"
  llm-model: "gpt-4o-mini"
  
  # API Base URLs
  openai-api-base: ""
  deepseek-api-base: "https://api.deepseek.com"
  anthropic-api-base: ""
  
  # 数据库配置
  database-url: "postgresql://user:password@postgres:5432/agenticx"
  
  # 应用配置
  app-config: |
    app:
      name: agenticx-app
      version: 1.0.0
      debug: false
    server:
      host: 0.0.0.0
      port: 8000
      workers: 1
"""
    
    def _get_k8s_deploy_script_template(self) -> str:
        """获取Kubernetes部署脚本模板"""
        return """#!/bin/bash
set -e

echo "Deploying AgenticX to Kubernetes..."

# 创建命名空间
kubectl create namespace agenticx --dry-run=client -o yaml | kubectl apply -f -

# 应用配置
kubectl apply -f k8s/ -n agenticx

# 等待部署完成
kubectl rollout status deployment/agenticx-app -n agenticx

echo "Deployment completed successfully!"
"""
    
    def _get_compose_template(self) -> str:
        """获取Docker Compose模板"""
        return """version: '3.8'

services:
  agenticx-app:
    build: .
    ports:
      - "8000:8000"
    environment:
      # LLM Provider 配置
      - LLM_PROVIDER=${LLM_PROVIDER:-openai}
      - LLM_MODEL=${LLM_MODEL:-gpt-4o-mini}
      
      # OpenAI
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - OPENAI_API_BASE=${OPENAI_API_BASE}
      
      # DeepSeek
      - DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}
      - DEEPSEEK_API_BASE=${DEEPSEEK_API_BASE}
      
      # Anthropic
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - ANTHROPIC_API_BASE=${ANTHROPIC_API_BASE}
      
      # Google Gemini
      - GOOGLE_API_KEY=${GOOGLE_API_KEY}
      - GOOGLE_API_BASE=${GOOGLE_API_BASE}
      
      # 数据库
      - DATABASE_URL=postgresql://postgres:password@postgres:5432/agenticx
    depends_on:
      - postgres
      - redis
    volumes:
      - ./logs:/app/logs
    restart: unless-stopped

  postgres:
    image: postgres:13
    environment:
      - POSTGRES_DB=agenticx
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:6-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - agenticx-app
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
"""
    
    def _get_env_template(self) -> str:
        """获取环境变量模板"""
        template_path = Path(__file__).parent / "env_template.txt"
        return template_path.read_text(encoding='utf-8')
    
    def _get_compose_start_script_template(self) -> str:
        """获取Compose启动脚本模板"""
        return """#!/bin/bash
set -e

echo "Starting AgenticX with Docker Compose..."

# 停止现有服务
docker-compose down

# 构建并启动服务
docker-compose up -d --build

# 等待服务启动
sleep 10

# 检查服务状态
docker-compose ps

echo "AgenticX is running at http://localhost:8000"
"""
    
    def _get_serverless_template(self) -> str:
        """获取Serverless配置模板"""
        return """service: agenticx-app

provider:
  name: aws
  runtime: python3.9
  region: us-east-1
  stage: ${opt:stage, 'dev'}
  
functions:
  app:
    handler: handler.handler
    events:
      - http:
          path: /{proxy+}
          method: ANY
          cors: true
    environment:
      # LLM Provider 配置
      LLM_PROVIDER: ${env:LLM_PROVIDER, 'openai'}
      LLM_MODEL: ${env:LLM_MODEL, 'gpt-4o-mini'}
      
      # OpenAI
      OPENAI_API_KEY: ${env:OPENAI_API_KEY}
      OPENAI_API_BASE: ${env:OPENAI_API_BASE}
      
      # DeepSeek
      DEEPSEEK_API_KEY: ${env:DEEPSEEK_API_KEY}
      DEEPSEEK_API_BASE: ${env:DEEPSEEK_API_BASE}
      
      # Anthropic
      ANTHROPIC_API_KEY: ${env:ANTHROPIC_API_KEY}
      ANTHROPIC_API_BASE: ${env:ANTHROPIC_API_BASE}
      
      # Google Gemini
      GOOGLE_API_KEY: ${env:GOOGLE_API_KEY}
      GOOGLE_API_BASE: ${env:GOOGLE_API_BASE}
      
      # 应用配置
      STAGE: ${self:provider.stage}
    timeout: 30
    memory: 512

plugins:
  - serverless-python-requirements
  - serverless-offline

custom:
  pythonRequirements:
    dockerizePip: true
    slim: true
    strip: false
"""
    
    def _get_lambda_template(self) -> str:
        """获取Lambda函数模板"""
        return """import json
import os
from mangum import Mangum
from fastapi import FastAPI
from agenticx import Agent, Task, AgentExecutor
from agenticx.llms import OpenAIProvider

app = FastAPI(title="AgenticX Serverless")

@app.get("/")
async def root():
    return {"message": "AgenticX Serverless API"}

@app.post("/agent/run")
async def run_agent(request: dict):
    # 创建智能体
    agent = Agent(
        id="serverless_agent",
        name="Serverless Agent",
        role="Assistant",
        goal="Execute tasks in serverless environment"
    )
    
    # 创建任务
    task = Task(
        id="task_1",
        description=request.get("description", "Default task"),
        expected_output="Task result"
    )
    
    # 执行任务
    llm = OpenAIProvider(api_key=os.getenv("OPENAI_API_KEY"))
    executor = AgentExecutor(agent=agent, llm=llm)
    result = executor.run(task)
    
    return {"result": result}

# Lambda handler
handler = Mangum(app)
"""