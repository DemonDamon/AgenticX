"""
AgenticX CLI 工具模块

提供命令行工具、项目脚手架、调试和部署等功能
"""

from agenticx._version import __version__


_LAZY_IMPORTS = {
    "main": ".main",
    "AgenticXClient": ".client",
    "AsyncAgenticXClient": ".client",
    "ProjectScaffolder": ".scaffold",
    "DebugServer": ".debug",
    "DocGenerator": ".docs",
    "DeployManager": ".deploy",
}


def __getattr__(name: str):
    module_name = _LAZY_IMPORTS.get(name)
    if module_name is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

    import importlib

    module = importlib.import_module(module_name, __package__)
    return getattr(module, name)

__all__ = [
    "main",
    "AgenticXClient", 
    "AsyncAgenticXClient",
    "ProjectScaffolder",
    "DebugServer",
    "DocGenerator", 
    "DeployManager"
] 