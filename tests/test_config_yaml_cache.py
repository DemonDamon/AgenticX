#!/usr/bin/env python3
"""ConfigManager 的 YAML 解析缓存。

get_value() 每次都把全局 + 项目两份配置重新从磁盘解析一遍，而它在读路径上被调用得
非常频繁：实测一次上下文用量估算触发 36 次 get_value / 57 次 yaml.safe_load，
占掉那一次请求 584ms 里的 558ms。桌面端「上下文用量」面板一直卡在"加载中…"就是
这么来的。
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from agenticx.cli.config_manager import ConfigManager


@pytest.fixture(autouse=True)
def _clean_cache():
    ConfigManager._invalidate_yaml_cache()
    yield
    ConfigManager._invalidate_yaml_cache()


def _count_parses(monkeypatch) -> list[int]:
    calls = [0]
    real = yaml.safe_load

    def counting(stream):
        calls[0] += 1
        return real(stream)

    monkeypatch.setattr("agenticx.cli.config_manager.yaml.safe_load", counting)
    return calls


def test_repeated_reads_parse_the_file_once(tmp_path, monkeypatch):
    path = tmp_path / "config.yaml"
    path.write_text("runtime:\n  a: 1\n", encoding="utf-8")
    calls = _count_parses(monkeypatch)

    for _ in range(20):
        assert ConfigManager._load_yaml(path) == {"runtime": {"a": 1}}
    assert calls[0] == 1


def test_a_changed_file_is_reparsed(tmp_path, monkeypatch):
    """缓存只能省时间，不能让调用方读到陈旧配置。"""
    path = tmp_path / "config.yaml"
    path.write_text("a: 1\n", encoding="utf-8")
    assert ConfigManager._load_yaml(path) == {"a": 1}

    path.write_text("a: 2\n", encoding="utf-8")
    assert ConfigManager._load_yaml(path) == {"a": 2}


def test_writing_through_dump_invalidates_immediately(tmp_path):
    """不靠 mtime 兜底：同一纳秒内先写后读理论上会读到陈旧值。"""
    path = tmp_path / "config.yaml"
    path.write_text("a: 1\n", encoding="utf-8")
    assert ConfigManager._load_yaml(path) == {"a": 1}

    ConfigManager._dump_yaml(path, {"a": 3})
    assert ConfigManager._load_yaml(path) == {"a": 3}


def test_caller_mutations_do_not_poison_the_cache(tmp_path):
    """_deep_merge 会就地改这个 dict —— 交出去的必须是副本。"""
    path = tmp_path / "config.yaml"
    path.write_text("providers:\n  kimi:\n    enabled: true\n", encoding="utf-8")

    first = ConfigManager._load_yaml(path)
    first["providers"]["kimi"]["enabled"] = False
    first["injected"] = "boom"

    second = ConfigManager._load_yaml(path)
    assert second == {"providers": {"kimi": {"enabled": True}}}


def test_missing_file_is_still_empty_and_clears_stale_cache(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text("a: 1\n", encoding="utf-8")
    assert ConfigManager._load_yaml(path) == {"a": 1}

    path.unlink()
    assert ConfigManager._load_yaml(path) == {}


def test_get_value_stops_reparsing_on_every_call(tmp_path, monkeypatch):
    """这才是真正被 hot path 打爆的入口。"""
    global_path = tmp_path / "global.yaml"
    global_path.write_text("runtime:\n  tool_search:\n    mode: auto\n", encoding="utf-8")
    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", global_path)
    monkeypatch.setattr(ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / "missing.yaml")

    calls = _count_parses(monkeypatch)
    for _ in range(30):
        assert ConfigManager.get_value("runtime.tool_search.mode") == "auto"
    # 全局解析一次；项目配置不存在，走 stat 失败分支，一次都不解析。
    assert calls[0] == 1


def test_a_non_dict_config_still_raises(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text("- just\n- a list\n", encoding="utf-8")
    with pytest.raises(ValueError):
        ConfigManager._load_yaml(path)
