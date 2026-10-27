# AgenticX Extensions 模块总结

> 结论更新时间：2026-10-25（覆盖基线 `ca9d92bec05627539228094cacc30dd6d4879f47` 之后至 `22d051f5d18ad83a4c6083683342ab41d7850149` 的变更）

## 模块概述

AgenticX Extensions 模块定义了 **AGX Bundle** 扩展生态：一种可分发的扩展包格式，以及围绕它的本地安装/卸载、多源注册表聚合搜索与技能目录监听能力。一个 AGX Bundle 可以同时携带 Skills、MCP server 配置、Avatar 预设和 Memory 模板，使「技能 + 工具 + 人设 + 记忆模板」能够作为一个整体被发布、安装和管理。

## 目录结构

```
agenticx/extensions/
├── __init__.py            # 导出 BundleManifest / RegistryHub / SearchResult 等
├── bundle.py              # AGX Bundle 清单（agx-bundle.yaml）定义与解析
├── installer.py           # 本地安装 / 卸载 / 列举已装 Bundle
├── registry_hub.py        # 多源注册表（agx / clawhub）聚合搜索与安装
├── skill_watcher.py       # 监听 SKILL.md 文件变更（基于 watchdog，去抖回调）
├── skillhub_adapter.py    # SkillHub 市场搜索 / 确定性安装（CLI + HTTP API + ClawHub 回退）
└── skillhub_install_guard.py  # SkillHub 安装意图与旧版 Meta 死路径提示词拦截
```

## 核心组件分析

### Bundle 清单定义与解析 (bundle.py)

**文件功能**：定义 AGX Bundle 清单格式并提供解析器

**核心组件**：
- `BundleManifest`：解析后的清单数据类，含 `name`/`version`/`description`/`author`/`license`/`format_version`，以及四类组件引用列表和 `source_dir`；`to_dict()` 序列化为 API/UI 友好结构
- `BundleSkillRef` / `BundleMcpRef` / `BundleAvatarRef` / `BundleMemoryRef`：四类组件引用，各自提供 `resolved_path()` / `resolved_config_path()` 将相对路径解析到 bundle 目录内
- `parse_bundle_manifest(bundle_dir)`：从目录读取 `agx-bundle.yaml`，校验 `agx_bundle` 格式版本（支持 `1.0`/`1`）与必填 `name`，逐项解析四类组件
- `BundleParseError`：清单解析失败异常

**安全要点**：`_validate_relative_path()` 强制所有组件路径为相对路径且不得越出 bundle 目录（防止路径穿越），非法条目仅告警并跳过而非整体失败。

### Bundle 安装器 (installer.py)

**文件功能**：将 AGX Bundle 从本地目录安装到 `~/.agenticx/`，支持卸载与列举

**安装布局**：
- skills → `~/.agenticx/skills/bundles/<bundle-name>/<skill-name>/`
- avatars → `~/.agenticx/avatars/presets/<bundle-name>/<avatar>.yaml`
- memory → `~/.agenticx/workspace/memory_templates/<bundle-name>/`
- MCP server 配置合并进 `~/.agenticx/mcp.json`
- 安装记录写入 `~/.agenticx/bundles.json`（注册表）

**核心组件**：
- `install_bundle(source, *, acknowledge_high_risk, confirm_non_high_risk, auto_non_high)`：解析清单 → **安装前安全扫描**（`scan_bundle_source`，复用 `skills.guard`）→ 按风险等级做安装前置确认（`dangerous` 需显式确认，`safe`/`caution` 可配置是否需确认）→ 拷贝组件 → 记录注册表
- `scan_bundle_source(source)`：解析清单后逐个调用 `scan_skill` 扫描每个引用技能，合并裁决（`merge_verdicts`）
- `uninstall_bundle(name)`：按 `bundles.json` 记录删除 skills/avatars/memory 目录与 `mcp.json` 中的 server 条目
- `list_installed_bundles()`：读取注册表返回 `InstalledBundle` 列表
- `InstalledBundle` / `InstallResult`：安装记录与安装结果数据类（结果含 `scan_summary` 与 `error_code`）

**健壮性**：`bundles.json` / `mcp.json` 读写均采用临时文件 + `os.replace` 原子写，并以 `threading.RLock` 保护并发安装。

### 多源注册表聚合 (registry_hub.py)

**文件功能**：跨多个扩展注册表统一搜索与安装

**支持的注册表类型**：
- `agx`：AgenticX 原生注册表（兼容 `agenticx.skills.registry` REST API，`GET /skills?q=`）
- `clawhub`：ClawHub API 适配（搜索 + 三步下载 SKILL.md）
- 配置来源：`~/.agenticx/config.yaml` 的 `extensions.registries` 与 `extensions.scan_dirs`

**核心组件**：
- `RegistryHub.from_config()`：从用户配置构建实例
- `search(query)`：跨所有配置源搜索，按 `source_type:name` 去重；**若全部源失败则抛 `RuntimeError`**，避免把「全部失败」误当「无结果」
- `_search_agx` / `_search_clawhub`：分别对接两类源；ClawHub 侧带 429 限流重试与 `retry-after`/`ratelimit-reset` 等待计算
- `fetch_skill_markdown` / `fetch_skill_package` / `install`：ClawHub 走「versions → version detail → download（整包 zip）」；安装时写入 SKILL.md 及包内附属文件，并支持 `ownerHandle` 消歧
- `write_registry_skill`：将技能写入 `~/.agenticx/skills/registry/<name>/SKILL.md`
- `SearchResult` / `InstallResult`：搜索与安装结果数据类；ClawHub 搜索结果额外携带 `owner`（publisher handle）
- `split_clawhub_ref` / `format_clawhub_conflict`：解析 `@owner/slug` 并在 HTTP 409 时给出可读冲突说明
- `fetch_skill_package` / `_extract_skill_package_zip`：ClawHub 下载整包 zip（含 `cli.js`/`scripts/` 等），带文件数与体积上限；`scan_skill_package` 对整包做 guard 扫描
- `write_registry_skill_dir` / `write_registry_skill_package`：将 SKILL.md 与附属文件写入 `~/.agenticx/skills/registry/<name>/`

**网络要点**：所有 httpx 请求使用 `trust_env=False`，刻意不继承环境中的 `HTTP(S)_PROXY`/SOCKS，避免代理破坏对公开 HTTPS 注册表的 TLS 访问。

### 技能目录监听 (skill_watcher.py)

**文件功能**：基于 watchdog 监听技能根目录下 `SKILL.md` 的增删改，触发去抖回调

**核心组件**：
- `SkillDirWatcher(skills_root, on_change, debounce_s=1.0)`：递归监听，仅对 `SKILL.md` 变更生效，使用 `threading.Timer` 做去抖；`start()`/`stop()` 可重复安全调用
- `_SkillFileHandler`：内部 watchdog handler，过滤目录事件与非 `SKILL.md` 文件

### SkillHub 市场适配 (skillhub_adapter.py)

**文件功能**：为 Desktop/Studio 提供 SkillHub 风格的市场搜索与**确定性安装**（须先解析 `namespace`，否则下载 API 易 404）

**核心组件**：
- `search_skillhub_market(query)`：CLI → SkillHub HTTP 搜索 API → 内置目录 → ClawHub 回退；结果行含 `namespace`/`canonical`
- `resolve_skillhub_namespace` / `parse_skillhub_ref`：从 `@ns/slug` 或搜索行解析 publisher namespace
- `install_skillhub_skill` / `uninstall_market_skill`：拉取整包、guard 扫描、经 `RegistryHub.write_registry_skill_package` 落盘；支持内置 `agenticx-agent-obs` 本地目录短路
- `_search_via_skillhub_cli`：调用 `skillhub search --json`/`--format json` 解析结果

### SkillHub 安装守卫 (skillhub_install_guard.py)

**文件功能**：与 Desktop `skillhub-install-prompt.ts` 对齐，拦截 Settings Meta 种子中复用的旧版 `POST /api/registry/install` 等死路径文案；普通聊天 `@ns/slug` /「安装 xxx skill」不拦截，由对话侧工具处理。

**核心组件**：
- `classify_skillhub_inbound_install_prompt`：仅对 `forbidden_meta` 类文案返回 `hit`
- `market_install_tool_for_intent`：将明确安装意图映射为 `skillhub_install` / `clawhub_install`，供运行时 `tool_choice` 强制首轮调用
- `extract_skillhub_install_slug` / `is_clear_skillhub_install_intent`：从用户文案提取 slug 或 `@ns/slug`

## 设计模式

### 1. 策略 / 适配器模式
- `RegistryHub` 按 `type`（agx/clawhub）分派到不同的搜索与安装实现
- 四类 Bundle 组件引用统一抽象为 `resolved_*_path` 接口

### 2. 信任分级安装策略
- 安装前置安全扫描复用 `skills.guard` 的裁决体系（safe/caution/dangerous）
- 通过 `acknowledge_high_risk` / `confirm_non_high_risk` / `auto_non_high` 参数让上层 UI 决定确认策略

### 3. 原子写入与并发保护
- 注册表与 mcp.json 全部走临时文件 + `os.replace`，配合进程内锁，避免并发安装时的写竞态与文件损坏

## 技术亮点

1. **四合一扩展包**：单个 Bundle 同时承载 skills/mcp/avatars/memory，把分散的扩展资产统一为可分发单元
2. **安装前安全前置**：复用技能安全扫描器，把风险评估提前到安装动作之前，并将裁决细节透出供 UI 展示
3. **多源聚合 + 失败可见**：跨注册表去重聚合，全部失败时显式报错而非静默返回空，便于排障
4. **路径穿越防护**：清单解析阶段强制相对路径校验，安装阶段校验解析路径不越界
5. **代理无关网络访问**：注册表请求绕开环境代理，规避 SOCKS/代理导致的 TLS 失败
6. **多文件技能整包安装**：ClawHub/SkillHub 路径解压并校验 zip 后整目录写入 registry，避免只装 SKILL.md 导致脚本类技能不可用
7. **安装意图与死路径治理**：Python/TS 双侧 guard 拒绝过时 Meta 安装提示，并将明确市场安装意图路由到专用工具

## 应用场景

1. **扩展市场**：Desktop 端 MCP/技能市场的搜索、预览与安装后端
2. **企业内部扩展分发**：将定制 SOP 技能 + 配套 MCP + 人设打包为 Bundle 内部分发
3. **技能热更新**：监听本地技能目录变更，驱动运行时刷新可用技能
4. **多源采购**：同时对接官方注册表、ClawHub 与本地目录，统一检索安装

## 总结

AgenticX Extensions 模块以 AGX Bundle 为核心，构建了「定义 → 搜索 → 扫描 → 安装 → 监听」的完整扩展生命周期闭环；SkillHub/ClawHub 侧进一步支持 publisher namespace、整包落盘与安装意图守卫，使社区技能安装从「仅 Markdown」升级为可执行的多文件包。它将技能、工具、人设与记忆模板统一为可分发的扩展资产，并通过安全前置、原子写入与多源聚合保障了扩展安装的安全性与可靠性，是 AgenticX 扩展生态的基础设施层。
