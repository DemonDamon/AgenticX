# Package Root 模块结论

## Responsibility
- 作为 `agenticx` 顶层 Python 包的**门面与胶水层**：版本号、可选依赖导入辅助、产品品牌常量、Agent 预设模板，以及在非 CLI 启动时聚合导出 core/llms/tools/memory 等子包公共 API。
- 与 `pyproject.toml`、`requirements.txt` 共同定义包元数据、Python 版本下限（>=3.10）与核心/可选 extras 依赖契约（`requirements.txt` 为 `pyproject.toml [project.dependencies]` 的镜像，注释要求先改 pyproject）。
- Explicit non-responsibilities: 不实现各子包业务逻辑；子目录（`core/`、`studio/`、`runtime/` 等）由对应 module conclusion 覆盖；本结论不含 `agenticx/**/*.py` 除根目录五个文件外的任何代码。

## Entry points and public interfaces
- `agenticx/__init__.py`：`__version__`（来自 `_version`）、`__author__` / `__email__`；非 CLI 时 re-export 大量符号（Agent、Task、Workflow、LLM providers、memory、protocols、hooks、flow、delegation、observability 等），见模块末尾 `__all__`。
- `agenticx._version.__version__`：当前 `"0.4.2"`，与 `pyproject.toml` `project.version` 一致；`agx` CLI（`agenticx/cli/main.py`）直接导入以加速 `--version`。
- `agenticx._optional.import_optional` / `is_module_available`：按 extras 组名生成友好 `ImportError` 提示（`pip install "agenticx[{extras_group}]"`）。
- `agenticx.branding`：`APP_DISPLAY_NAME`、`DEFAULT_META_PRODUCT_LABEL`（均为 `"Near"`）、`LEGACY_META_LABELS`（`Machi` / `machi` 兼容）。
- `agenticx.presets`：`AgentPreset` dataclass；`load_preset_from_dict` / `load_preset_from_yaml`；`create_agent_from_preset` → `agenticx.core.agent.Agent` 实例。

## Core execution path
- **库导入**：`import agenticx` 且 `sys.argv[0]` 基名**不是** `agx`/`agenticx` 时，执行重量级子模块导入并填充 namespace；否则（CLI bootstrap）跳过子模块导入以降低冷启动成本（`_IS_CLI_BOOTSTRAP`）。
- **CLI 版本**：`agx` → `from agenticx._version import __version__` → Typer/Rich 输出，无需加载 core 导出链。
- **预设建 Agent**：YAML/frontmatter → `load_preset_from_yaml` → `AgentPreset` → `create_agent_from_preset` 合并 `settings` 与 overrides → `_filter_agent_kwargs` 仅保留 `Agent.model_fields` 键 → `Agent(**kwargs)`。

## Important classes and functions
- `AgentPreset` / `load_preset_from_dict` / `load_preset_from_yaml` / `create_agent_from_preset`（`presets.py`）。
- `import_optional` / `is_module_available`（`_optional.py`）。
- `APP_DISPLAY_NAME`、`DEFAULT_META_PRODUCT_LABEL`、`LEGACY_META_LABELS`（`branding.py`）。
- `__version__`（`_version.py`）；`__init__.py` 内 `_SAVED_CLI_ARGV` 保存导入前 argv 快照。

## Data and configuration
- 版本与作者：`pyproject.toml` `[project]`（name `agenticx`、version、authors、classifiers、keywords）。
- 依赖分层：`[project.dependencies]` 核心轻量栈；`[project.optional-dependencies]` 含 `desktop-runtime`、`dev`、`memory`、`graph` 等 extras（详见 pyproject，不在此枚举）。
- `requirements.txt`：核心依赖镜像 + 安装说明（`pip install -e .` / extras / 可选 lock）。
- 品牌常量硬编码于 `branding.py`，运行时可通过各调用方 env（如 `AGX_WECHAT_REPLY_NAME`）覆盖展示名，但非本模块职责。

## Dependencies
- Upstream:  setuptools 构建；`presets.py` 依赖 `PyYAML` 与 `agenticx.core.agent.Agent`；`__init__.py` 条件依赖几乎所有一级子包。
- Downstream: 文档与示例 `from agenticx import Agent, Task, AgentExecutor`；`agx` CLI 读 `_version`；`agenticx.studio.server`、`agenticx.runtime.meta_tools`、`agenticx.runtime.group_router`、`agenticx.gateway.adapters.wechat_ilink` 读 `branding`；`tests/test_smoke_cherry_studio_preset.py` 测 presets；脚手架 `agenticx/cli/scaffold.py` 生成 `from agenticx import ...` 代码。

## Tests and operations
- `tests/test_smoke_cherry_studio_preset.py`：`AgentPreset` 加载与 `create_agent_from_preset` 校验。
- `tests/test_smoke_ark_provider.py` 等通过 `from agenticx import ArkLLMProvider` 验证根导出。
- 发布：版本 bump 需同步 `agenticx/_version.py` 与 `pyproject.toml`；`pip install -e .` 为本地开发标准入口。
- CLI 性能：打包/冒烟时确认 `agx --version` 不触发全量 `__init__` 导入链。

## Unverified or ambiguous
- `__all__` 列出 `AgentProtocol`、`TaskProtocol`、`ToolProtocol`，但 `__init__.py` 可见导入段未绑定这三者；`from agenticx import AgentProtocol` 在非 CLI 路径下可能失败，属导出列表与实现不一致。
- `agenticx._optional` 在仓库内**未发现**其他模块引用；可能为预留或文档化 extras 用，实际 optional import 路径待确认。
- `__author__` / `pyproject.toml` authors 与 `branding.APP_DISPLAY_NAME`（Near）语义不同：前者为包元数据作者，后者为产品显示名。
