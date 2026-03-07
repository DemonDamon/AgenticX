---
name: CLI UX Enhancement
overview: 优化 agx CLI 的三个核心体验问题：启动速度从 ~8s 降至 <1s、无参行为从报错改为欢迎页、未知命令给出纠错建议。
todos:
  - id: t1
    content: "Task 1: CLI 启动速度优化 -- 创建 _version.py + 延迟导入 cli/__init__.py"
    status: completed
  - id: t2
    content: "Task 2: agx 无参欢迎页 -- invoke_without_command + _print_welcome()"
    status: completed
  - id: t3
    content: "Task 3: 未知命令纠错建议 -- AgenticXGroup.resolve_command() + difflib"
    status: completed
  - id: t4
    content: "Task 4: 验证启动速度/无参行为/纠错/回归 + 提交"
    status: completed
isProject: false
---

# AgenticX CLI 体验优化计划

## 问题诊断

当前 `agx` 命令存在三个核心体验问题：

1. **启动极慢（~8s）**：`agenticx/__init__.py` 在顶层急切导入了 core/llms/tools/memory/protocols/hooks/flow/collaboration/observability 全部模块。CLI 入口 `main.py:20` 的 `from agenticx import __version__` 会触发整个包的加载。裸 `import typer` 只需 0.07s。
2. **无参报错不友好**：根 `app = typer.Typer(...)` 缺少 `invoke_without_command=True`，直接敲 `agx` 报 `Missing command.`
3. **未知命令无提示**：输入 `agx wokflow` 等拼写错误时，无纠错建议

## Task 1: CLI 启动速度优化 -- `__version__` 免导入

**核心改动**：让 CLI 获取版本号时不触发 `agenticx/__init__.py` 的全量导入。

**文件**: [agenticx/cli/main.py](agenticx/cli/main.py)

将第 20 行：

```python
from agenticx import __version__
```

改为直接读 `agenticx/_version.py`（或直接 hardcode 版本模块路径）：

```python
def _get_version() -> str:
    """Read version without importing the full agenticx package."""
    import importlib.util
    spec = importlib.util.spec_from_file_name(
        "_version", 
        str(Path(__file__).resolve().parent.parent / "__init__.py")
    )
    # 更简单的方式：直接用 importlib.metadata
    from importlib.metadata import version as pkg_version
    try:
        return pkg_version("agenticx")
    except Exception:
        return "0.3.0"
```

或者更干净的方案：创建 `agenticx/_version.py` 只含 `__version__ = "0.3.0"`，`__init__.py` 和 `cli/main.py` 都从 `_version.py` 读取。这样 CLI 导入 `_version` 不会触发全量加载。

**文件**: 新建 [agenticx/_version.py](agenticx/_version.py)

```python
__version__ = "0.3.0"
```

**文件**: [agenticx/**init**.py](agenticx/__init__.py) 第 31 行

```python
# 改为从 _version 导入
from agenticx._version import __version__
```

**文件**: [agenticx/cli/main.py](agenticx/cli/main.py) 第 20 行

```python
# 改为从 _version 导入，避免触发全量导入
from agenticx._version import __version__
```

**文件**: [agenticx/cli/**init**.py](agenticx/cli/__init__.py)

全部改为延迟导入，不在模块级导入 client/scaffold/debug/docs/deploy：

```python
"""AgenticX CLI 工具模块"""

def __getattr__(name):
    _lazy_imports = {
        "main": ".main",
        "AgenticXClient": ".client",
        "AsyncAgenticXClient": ".client",
        "ProjectScaffolder": ".scaffold",
        "DebugServer": ".debug",
        "DocGenerator": ".docs",
        "DeployManager": ".deploy",
    }
    if name in _lazy_imports:
        import importlib
        mod = importlib.import_module(_lazy_imports[name], __package__)
        return getattr(mod, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
```

**预期效果**: `agx --help` 从 ~8s 降到 <0.5s。

## Task 2: `agx` 无参欢迎页

**文件**: [agenticx/cli/main.py](agenticx/cli/main.py)

两处改动：

(a) 根 Typer 开启 `invoke_without_command`：

```python
app = typer.Typer(
    name="agenticx",
    help="AgenticX: 统一的多智能体框架 - 开发者工具套件",
    add_completion=False,
    invoke_without_command=True,   # 新增
    no_args_is_help=False,         # 新增：不自动打印 Typer 默认帮助
)
```

(b) `main_callback` 中检测无子命令时打印欢迎页：

```python
@app.callback(invoke_without_command=True)
def main_callback(ctx: typer.Context, ...):
    if ctx.invoked_subcommand is None:
        _print_welcome()

def _print_welcome():
    """Print a concise welcome page with usage hints."""
    from rich.panel import Panel
    from rich.table import Table
    
    # 版本 + 标语
    console.print(f"\n[bold blue]AgenticX[/bold blue] v{__version__}")
    console.print("[dim]统一的多智能体框架 - 开发者工具套件[/dim]\n")
    
    # 常用命令表
    table = Table(show_header=False, box=None, padding=(0, 2))
    table.add_column("Command", style="cyan")
    table.add_column("Description")
    table.add_row("agx run <file>",           "执行工作流文件")
    table.add_row("agx project create <name>", "创建新项目")
    table.add_row("agx agent list",            "列出所有智能体")
    table.add_row("agx skills list",           "查看已安装技能")
    table.add_row("agx serve",                 "启动 API 服务器")
    console.print(Panel(table, title="常用命令", title_align="left", expand=False))
    
    console.print("[dim]输入 agx --help 查看全部命令[/dim]\n")
```

## Task 3: 未知命令纠错建议

**文件**: [agenticx/cli/main.py](agenticx/cli/main.py)

在 `main()` 入口函数中捕获 Typer/Click 的 `UsageError` 或 `BadParameter`，当错误信息包含未知命令时，用 `difflib.get_close_matches` 做相似度推荐：

```python
def main():
    """主入口函数"""
    import agenticx
    sys.argv = agenticx._SAVED_CLI_ARGV
    try:
        app()
    except SystemExit:
        raise
    except click.UsageError as e:
        _handle_unknown_command(e)
```

或者更优雅的方式：自定义 Typer 的 Click Group 类，覆写 `resolve_command()`：

```python
import click
import difflib

class AgenticXGroup(click.Group):
    def resolve_command(self, ctx, args):
        try:
            return super().resolve_command(ctx, args)
        except click.UsageError:
            cmd_name = args[0] if args else ""
            matches = difflib.get_close_matches(
                cmd_name, self.list_commands(ctx), n=3, cutoff=0.5
            )
            msg = f"未知命令: '{cmd_name}'"
            if matches:
                suggestions = ", ".join(f"'{m}'" for m in matches)
                msg += f"\n\n  你是不是想输入: {suggestions}"
            msg += "\n\n  输入 agx --help 查看全部命令"
            raise click.UsageError(msg)

# 创建 app 时注入自定义 Group
app = typer.Typer(
    cls=AgenticXGroup,
    ...
)
```

## Task 4: 验证和提交

- 测量启动速度：`time agx`、`time agx --version`、`time agx --help`
- 验证无参行为：`agx` 应显示欢迎页
- 验证纠错建议：`agx wokflow` 应提示 `workflow`
- 验证子命令不受影响：`agx project`、`agx agent list` 等
- 运行现有 CLI 相关测试（如有）
- 提交

## 风险和注意事项

- `_SAVED_CLI_ARGV` 机制需要保留（GTK/graph-tool 会修改 sys.argv），但可以在 `_version.py` 中不触发
- `agenticx/cli/__init__.py` 的延迟导入改动可能影响通过 `from agenticx.cli import AgenticXClient` 直接使用 CLI 子模块的外部代码，需确认无此用法或做兼容
- `click.Group.resolve_command` 是 Click 内部 API，需确认 Typer 兼容（Typer 底层就是 Click Group）

