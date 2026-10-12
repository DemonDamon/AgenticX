# Octop-07：全局 config.yaml 原子写 + 末次良好备份

Planned-with: Claude Sonnet 5.5
Suggested-Impl-Model: Composer 2.5（单文件、有明确模式）
Plan-Id: 2026-10-02-octop-07-config-atomic-write
Plan-File: `.cursor/plans/2026-10-02-octop-07-config-atomic-write.plan.md`
Parent: `.cursor/plans/2026-10-01-openmuse-selective-adopt-master.plan.md`（Wave C）
Source: `research/codedeepresearch/Octop/Octop_source_notes.md` §10 P2「Plugin 写 config corrupt 硬失败」（E-010，issue #730 同类）

> **For implementer:** 独立 worktree（分支 `feat/octop-07-config-atomic`，基于 main HEAD）。不要 commit。严守 `no-scope-creep.mdc`。

## Goal

`~/.agenticx/config.yaml` 装着 provider 密钥、MCP、权限、语音等全部用户配置。当前写入非原子：进程在写入中途崩溃/断电会得到截断文件，下次读取抛错，用户配置全丢。改为「临时文件 + fsync + `os.replace` 原子替换」，并在覆盖前保留上一版 `config.yaml.bak`。

## 现状证据

`agenticx/cli/config_manager.py`：
- `_load_yaml`（≈L274）：文件存在但 YAML 非法 → `yaml.safe_load` 抛异常；非 dict → `ValueError`。**读写路径已是「损坏则硬失败」，不会把读失败当空再写回**——这点已满足 Octop 的 #730 教训，**保持不动**。
- `_dump_yaml`（≈L306）：`path.open("w")` 先截断再 `yaml.safe_dump`——**这是唯一缺口**。

## 改动（仅 `_dump_yaml`）

before：
```python
path.parent.mkdir(parents=True, exist_ok=True)
with path.open("w", encoding="utf-8") as f:
    yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)
cls._invalidate_yaml_cache(path)
```
after（意图伪码）：
```python
path.parent.mkdir(parents=True, exist_ok=True)
text = yaml.safe_dump(data, sort_keys=False, allow_unicode=True)   # 先序列化，失败则原文件毫发无损
tmp = path.with_name(path.name + f".tmp.{os.getpid()}")
with tmp.open("w", encoding="utf-8") as f:
    f.write(text); f.flush(); os.fsync(f.fileno())
if path.exists():
    shutil.copy2(path, path.with_name(path.name + ".bak"))      # 覆盖前备份上一版
os.replace(tmp, path)                                            # 原子替换
cls._invalidate_yaml_cache(path)
```
- 失败时（序列化/写 tmp 异常）清理 tmp 并抛出原异常；不得吞异常。
- 文件权限：若原文件存在，`os.chmod(tmp, stat.S_IMODE(path.stat().st_mode))`（config 含密钥，勿变宽）。
- 顶部 import 区仅**增行** `os`/`shutil`/`stat`（如已存在则不重复）；不得整段替换 import。

## In scope / Out of scope

In：`_dump_yaml` 一处 + 测试。  
Out：`_load_yaml` 行为、缓存逻辑、`set_value`/`update_section` 等调用方、project 级配置语义、任何自动「从 .bak 恢复」逻辑（本次只留备份，不自动用）。

## AC

- `tests/test_config_manager_atomic_write.py`：
  1. `test_dump_creates_bak_of_previous`：写两次，`.bak` 内容等于第一次。
  2. `test_failed_serialize_keeps_original`：`data` 含不可序列化对象（如 `object()`）→ 抛异常，原文件字节不变，目录内无遗留 `.tmp.*`。
  3. `test_replace_failure_cleans_tmp`：monkeypatch `os.replace` 抛 `OSError` → 原文件不变、tmp 被清理。
  4. `test_mode_preserved`：原文件 0600，写后仍 0600。
  5. 现有 config 相关测试不回归：`python -m pytest tests -q --no-cov -k "config_manager or config_" `。

## 验证

```bash
python -m pytest tests/test_config_manager_atomic_write.py -q --no-cov
```
