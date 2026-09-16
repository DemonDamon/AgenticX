#!/usr/bin/env python3
"""Smoke tests for avatar portrait generation.

Author: Damon Li
"""

from __future__ import annotations

from unittest.mock import patch

from agenticx.avatar.portrait import (
    PORTRAIT_STYLE,
    PORTRAIT_STYLE_CUSTOM,
    build_avatar_portrait_svg,
    build_collection_portrait_url,
    fetch_collection_portrait_url,
    generate_avatar_portrait_url,
    infer_portrait_traits,
    needs_portrait_refresh,
)
from agenticx.avatar.registry import AvatarRegistry

_FAKE_PNG = (
    b"\x89PNG\r\n\x1a\n"
    + b"\x00\x00\x00\rIHDR"
    + b"\x00" * 17
    + b"IEND"
    + b"\x00" * 16
)
_PNG_DATA_URL = "data:image/png;base64,abc"


def test_generate_avatar_portrait_url_is_data_svg() -> None:
    url = generate_avatar_portrait_url(name="飞坦", role="算法工程专家", avatar_id="abc123")
    assert url.startswith("data:image/svg+xml;base64,")
    assert len(url) > 80


def test_portrait_is_deterministic_for_same_seed() -> None:
    a = build_avatar_portrait_svg(name="程基岩", role="引擎工程师", avatar_id="same-id")
    b = build_avatar_portrait_svg(name="程基岩", role="引擎工程师", avatar_id="same-id")
    assert a == b


def test_portrait_differs_for_different_ids() -> None:
    a = build_avatar_portrait_svg(name="测试", role="测试", avatar_id="id-a")
    b = build_avatar_portrait_svg(name="测试", role="测试", avatar_id="id-b")
    assert a != b


def test_create_avatar_auto_assigns_portrait(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("agenticx.avatar.registry.AVATARS_ROOT", tmp_path)
    registry = AvatarRegistry()
    cfg = registry.create_avatar(name="安全·司南", role="安全 / 权限 / 合规")
    assert cfg.avatar_url.startswith("data:image/svg+xml;base64,")
    assert cfg.portrait_style == PORTRAIT_STYLE


def test_collection_url_is_deterministic() -> None:
    a = build_collection_portrait_url(name="飞坦", avatar_id="abc")
    b = build_collection_portrait_url(name="飞坦", avatar_id="abc")
    assert a == b
    assert "notionists" in a
    assert "avataaars" not in a
    assert "seed=" in a


def test_fetch_collection_returns_png_data_url() -> None:
    class _Resp:
        headers = {"Content-Type": "image/png"}

        def read(self, _n: int) -> bytes:
            return _FAKE_PNG

        def __enter__(self) -> "_Resp":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

    with patch("agenticx.avatar.portrait.urllib.request.urlopen", return_value=_Resp()):
        url = fetch_collection_portrait_url(name="飞坦", avatar_id="abc")
    assert url is not None
    assert url.startswith("data:image/png;base64,")


def test_fetch_collection_failure_returns_none() -> None:
    with patch(
        "agenticx.avatar.portrait.urllib.request.urlopen",
        side_effect=TimeoutError("offline"),
    ):
        assert fetch_collection_portrait_url(name="飞坦", avatar_id="abc") is None


def test_generate_uses_collection_when_enabled(monkeypatch) -> None:
    monkeypatch.setattr(
        "agenticx.avatar.portrait.collection_fetch_enabled",
        lambda: True,
    )
    monkeypatch.setattr(
        "agenticx.avatar.portrait.fetch_collection_portrait_url",
        lambda **_kwargs: _PNG_DATA_URL,
    )
    url = generate_avatar_portrait_url(name="飞坦", role="算法", avatar_id="abc")
    assert url == _PNG_DATA_URL


def test_list_backfills_empty_portrait_when_fetch_works(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("agenticx.avatar.registry.AVATARS_ROOT", tmp_path)
    monkeypatch.setattr(
        "agenticx.avatar.registry.collection_fetch_enabled",
        lambda: True,
    )
    monkeypatch.setattr(
        "agenticx.avatar.registry.fetch_collection_portrait_url",
        lambda **_kwargs: _PNG_DATA_URL,
    )
    registry = AvatarRegistry()
    cfg = registry.create_avatar(name="路远行", role="发行运营")
    cfg.avatar_url = ""
    cfg.portrait_style = ""
    registry._write_config(cfg)
    listed = registry.list_avatars()
    assert listed[0].avatar_url == _PNG_DATA_URL
    assert listed[0].portrait_style == PORTRAIT_STYLE


def test_list_replaces_geometric_svg_fallback(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("agenticx.avatar.registry.AVATARS_ROOT", tmp_path)
    monkeypatch.setattr(
        "agenticx.avatar.registry.collection_fetch_enabled",
        lambda: True,
    )
    monkeypatch.setattr(
        "agenticx.avatar.registry.fetch_collection_portrait_url",
        lambda **_kwargs: _PNG_DATA_URL,
    )
    registry = AvatarRegistry()
    cfg = registry.create_avatar(name="运维·磐石", role="基础设施运维工程师")
    assert cfg.avatar_url.startswith("data:image/svg+xml")
    listed = registry.list_avatars()
    assert listed[0].avatar_url == _PNG_DATA_URL
    assert listed[0].portrait_style == PORTRAIT_STYLE


def test_male_name_selects_short_hair() -> None:
    from urllib.parse import parse_qs, urlparse

    traits = infer_portrait_traits(name="运维·磐石", role="基础设施运维工程师")
    assert "variant01" in traits["hair"] or traits["beardProbability"] != "0"
    url = build_collection_portrait_url(
        name="运维·磐石",
        role="基础设施运维工程师",
        avatar_id="x",
    )
    query = parse_qs(urlparse(url).query)
    assert "clothing" not in query
    assert "top" not in query
    assert "hair" in query


def test_description_controls_gender_hair_glasses() -> None:
    traits = infer_portrait_traits(
        name="林绘澄",
        role="游戏美术",
        description="女设计师，长发，戴眼镜",
    )
    assert traits["beardProbability"] == "0"
    assert "variant12" in traits["hair"] or "variant24" in traits["hair"]
    assert traits["glassesProbability"] == "100"
    assert "variant" in traits["glasses"]


def test_short_hair_from_description() -> None:
    traits = infer_portrait_traits(
        name="飞坦",
        role="算法工程专家",
        description="男，短发，卫衣",
    )
    assert traits["beardProbability"] != "0" or "variant01" in traits["hair"]
    assert "variant01" in traits["hair"] or "variant03" in traits["hair"]


def test_needs_refresh_skips_current_and_custom() -> None:
    assert needs_portrait_refresh(_PNG_DATA_URL, portrait_style=PORTRAIT_STYLE) is False
    assert needs_portrait_refresh(_PNG_DATA_URL, portrait_style=PORTRAIT_STYLE_CUSTOM) is False


def test_needs_refresh_migrates_unmarked_png() -> None:
    assert needs_portrait_refresh(_PNG_DATA_URL, portrait_style="") is True
    assert needs_portrait_refresh("data:image/svg+xml;base64,abc", portrait_style=PORTRAIT_STYLE) is True
    assert needs_portrait_refresh("", portrait_style="") is True


def test_list_migrates_legacy_png_and_marks_style(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("agenticx.avatar.registry.AVATARS_ROOT", tmp_path)
    monkeypatch.setattr(
        "agenticx.avatar.registry.collection_fetch_enabled",
        lambda: True,
    )
    monkeypatch.setattr(
        "agenticx.avatar.registry.fetch_collection_portrait_url",
        lambda **_kwargs: "data:image/png;base64,new",
    )
    registry = AvatarRegistry()
    cfg = registry.create_avatar(name="前端·晴空", role="前端")
    cfg.avatar_url = _PNG_DATA_URL
    cfg.portrait_style = ""
    registry._write_config(cfg)
    listed = registry.list_avatars()
    assert listed[0].avatar_url == "data:image/png;base64,new"
    assert listed[0].portrait_style == PORTRAIT_STYLE


def test_list_keeps_custom_and_current_style(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("agenticx.avatar.registry.AVATARS_ROOT", tmp_path)
    monkeypatch.setattr(
        "agenticx.avatar.registry.collection_fetch_enabled",
        lambda: True,
    )
    monkeypatch.setattr(
        "agenticx.avatar.registry.fetch_collection_portrait_url",
        lambda **_kwargs: "data:image/png;base64,should-not-use",
    )
    registry = AvatarRegistry()
    custom = registry.create_avatar(name="自定义", role="x", avatar_url=_PNG_DATA_URL)
    assert custom.portrait_style == PORTRAIT_STYLE_CUSTOM
    current = registry.create_avatar(name="已线稿", role="y")
    current.avatar_url = "data:image/png;base64,keep"
    current.portrait_style = PORTRAIT_STYLE
    registry._write_config(current)
    listed = {item.name: item for item in registry.list_avatars()}
    assert listed["自定义"].avatar_url == _PNG_DATA_URL
    assert listed["已线稿"].avatar_url == "data:image/png;base64,keep"


def test_create_marks_generated_and_uploaded(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("agenticx.avatar.registry.AVATARS_ROOT", tmp_path)
    registry = AvatarRegistry()
    generated = registry.create_avatar(name="生成", role="角色")
    uploaded = registry.create_avatar(name="上传", role="角色", avatar_url=_PNG_DATA_URL)
    assert generated.portrait_style == PORTRAIT_STYLE
    assert uploaded.portrait_style == PORTRAIT_STYLE_CUSTOM


def test_update_empty_url_regenerates_line_art(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("agenticx.avatar.registry.AVATARS_ROOT", tmp_path)
    monkeypatch.setattr(
        "agenticx.avatar.registry.generate_avatar_portrait_url",
        lambda **_kwargs: "data:image/png;base64,regen",
    )
    registry = AvatarRegistry()
    cfg = registry.create_avatar(name="清空", role="x", avatar_url=_PNG_DATA_URL)
    updated = registry.update_avatar(cfg.id, {"avatar_url": ""})
    assert updated is not None
    assert updated.avatar_url == "data:image/png;base64,regen"
    assert updated.portrait_style == PORTRAIT_STYLE


def test_update_new_url_marks_custom(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("agenticx.avatar.registry.AVATARS_ROOT", tmp_path)
    registry = AvatarRegistry()
    cfg = registry.create_avatar(name="换图", role="x")
    updated = registry.update_avatar(cfg.id, {"avatar_url": "data:image/png;base64,user"})
    assert updated is not None
    assert updated.avatar_url == "data:image/png;base64,user"
    assert updated.portrait_style == PORTRAIT_STYLE_CUSTOM
