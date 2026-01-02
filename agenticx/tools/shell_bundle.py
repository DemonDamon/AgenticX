"""
Shell bundle loader (SWE-agent inspired)

提供最小可用的 Shell 工具包加载与执行能力：
- 读取 bundle/config.yaml（兼容 SWE-agent 格式：tools: {name: {signature, docstring}}）
- 将 bin/<tool_name> 封装为 BaseTool 派生类，执行本地 shell 脚本
- 可选 state_command（如 bin/_state），用于提取状态（JSON 优先，否则原样字符串）

版权声明：参考 SWE-agent/tools 的 bundle 机制（MIT License），做了最小适配以融入 AgenticX。
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

import yaml
from pydantic import BaseModel, Field, model_validator

from .base import BaseTool, ToolError, ToolValidationError


class ShellToolArgs(BaseModel):
    """通用 shell 工具参数：支持 args 列表与可选工作目录/env。"""

    args: List[str] = Field(default_factory=list, description="传递给脚本的参数列表")
    cwd: Optional[str] = Field(default=None, description="工作目录")
    env: Dict[str, str] = Field(default_factory=dict, description="附加环境变量")

    @model_validator(mode="after")
    def _normalize_args(self) -> "ShellToolArgs":
        # 支持传入单个字符串时自动拆分
        if isinstance(self.args, str):  # type: ignore[unreachable]
            self.args = [self.args]
        return self


class ShellScriptTool(BaseTool):
    """将 bin/<name> 脚本封装为工具。"""

    def __init__(self, script_path: Path, doc: str = "", enable_syntax_check: bool = False, **kwargs):
        if not script_path.exists():
            raise ToolValidationError(
                f"Script not found: {script_path}",
                tool_name=script_path.name,
                details={"path": str(script_path)},
            )
        if not script_path.is_file():
            raise ToolValidationError(
                f"Script is not a file: {script_path}",
                tool_name=script_path.name,
                details={"path": str(script_path)},
            )
        super().__init__(
            name=script_path.name,
            description=doc or f"Run shell script {script_path.name}",
            args_schema=ShellToolArgs,
            **kwargs,
        )
        self.script_path = script_path
        self.enable_syntax_check = enable_syntax_check

    def _run(self, **kwargs):
        args = ShellToolArgs(**kwargs)
        if self.enable_syntax_check:
            # 将命令还原为传入参数拼接的形式用于 bash -n 检查
            joined = " ".join(args.args)
            self.validate_bash_syntax(joined)
        cmd = [str(self.script_path)] + args.args
        try:
            completed = subprocess.run(
                cmd,
                cwd=args.cwd,
                env={**args.env} if args.env else None,
                text=True,
                capture_output=True,
                timeout=self.timeout,
                check=False,
            )
        except FileNotFoundError as exc:
            raise ToolError(
                f"Script not found: {self.script_path}",
                tool_name=self.name,
                details={"path": str(self.script_path)},
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise ToolError(
                f"Script timed out: {self.script_path}",
                tool_name=self.name,
                details={"timeout": self.timeout},
            ) from exc

        output = completed.stdout or ""
        stderr = completed.stderr or ""
        if completed.returncode != 0:
            raise ToolError(
                f"Script exited with {completed.returncode}: {stderr.strip()}",
                tool_name=self.name,
                details={"returncode": completed.returncode, "stderr": stderr},
            )
        return output.strip()


@dataclass
class BundleConfig:
    tools: Dict[str, Dict]
    state_command: Optional[str] = None


class ShellBundleLoader:
    """
    读取 shell bundle 并生成工具列表。

    期望结构：
    bundle/
      config.yaml  # 包含 tools 字典，state_command 可选
      bin/
        <tool_name> (可执行脚本)
        _state      (可选，返回 JSON 状态)
    """

    def __init__(self, bundle_dir: Path):
        self.bundle_dir = Path(bundle_dir).resolve()
        if not self.bundle_dir.exists():
            raise FileNotFoundError(f"Bundle dir not found: {bundle_dir}")
        self.config = self._load_config()
        self.tools = self._build_tools()

    def _load_config(self) -> BundleConfig:
        config_path = self.bundle_dir / "config.yaml"
        if not config_path.exists():
            raise FileNotFoundError(f"config.yaml not found in {self.bundle_dir}")
        data = yaml.safe_load(config_path.read_text()) or {}
        tools = data.get("tools")
        if not isinstance(tools, dict) or not tools:
            raise ValueError("config.yaml must define non-empty 'tools' mapping")
        state_command = data.get("state_command")
        return BundleConfig(tools=tools, state_command=state_command)

    def _build_tools(self) -> List[ShellScriptTool]:
        bin_dir = self.bundle_dir / "bin"
        if not bin_dir.exists():
            raise FileNotFoundError(f"bin/ not found in {self.bundle_dir}")

        tools: List[ShellScriptTool] = []
        for name, meta in self.config.tools.items():
            script_path = bin_dir / name
            doc = ""
            if isinstance(meta, dict):
                doc = meta.get("docstring") or meta.get("description") or meta.get("signature") or ""
            tool = ShellScriptTool(
                script_path=script_path,
                doc=doc,
                enable_syntax_check=bool(meta.get("enable_syntax_check", False)) if isinstance(meta, dict) else False,
            )
            if self.config.state_command:
                # 绑定 state sidecar，执行成功后会被 ToolExecutor 调用
                tool.post_state_hook = self.run_state  # type: ignore[attr-defined]
            tools.append(tool)
        return tools

    def load_tools(self) -> List[ShellScriptTool]:
        """返回封装后的工具实例列表。"""
        return self.tools

    def run_state(self) -> Dict:
        """执行 state_command（如果存在），尝试解析 JSON，否则返回 raw 字符串。"""
        if not self.config.state_command:
            return {}
        cmd_path = self.bundle_dir / "bin" / Path(self.config.state_command).name
        if not cmd_path.exists():
            raise FileNotFoundError(f"state_command not found: {cmd_path}")
        completed = subprocess.run(
            [str(cmd_path)],
            text=True,
            capture_output=True,
            check=False,
        )
        stdout = completed.stdout or ""
        if completed.returncode != 0:
            raise ToolError(
                f"state_command exited with {completed.returncode}",
                tool_name=str(cmd_path.name),
                details={"stderr": completed.stderr},
            )
        try:
            return json.loads(stdout)
        except json.JSONDecodeError:
            return {"raw": stdout.strip()}

