#!/usr/bin/env python3
"""Smoke tests for avatar portrait generation.

Author: Damon Li
"""

from __future__ import annotations

from unittest.mock import patch

from agenticx.avatar.portrait import (
    NEAR_MARK_COLORWAY_ID,
    PORTRAIT_STYLE,
    PORTRAIT_STYLE_CUSTOM,
    PORTRAIT_STYLE_LEGACY_GENERATED,
    build_avatar_portrait_svg,
    build_collection_portrait_url,
    build_near_mark_svg,
    cube_colorway_ids,
    extract_cube_colorway_id,
    fetch_collection_portrait_url,
    generate_avatar_portrait_url,
    infer_portrait_traits,
    is_local_fallback_svg,
    needs_portrait_refresh,
    portrait_ink_hex,
    resolve_cube_colorway,
    resolve_portrait_palette_key,
    tint_line_art_svg,
)
from agenticx.avatar.registry import AvatarRegistry

_PNG_DATA_URL = "data:image/png;base64,abc"
_GEOMETRIC_FALLBACK_URL = (
    "data:image/svg+xml;base64,"
    "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjggMTI4IiByb2xlPSJpbWciPjxyZWN0IHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4Ii8+PC9zdmc+"
)


def test_generate_avatar_portrait_url_is_data_svg() -> None:
    import base64

    url = generate_avatar_portrait_url(name="飞坦", role="算法工程专家", avatar_id="abc123")
    assert url.startswith("data:image/svg+xml;base64,")
    svg = base64.b64decode(url.split(",", 1)[1]).decode("utf-8")
    assert f'data-portrait="{PORTRAIT_STYLE}"' in svg
    assert 'viewBox="0 0 160 160"' in svg
    assert "data-colorway=" in svg
    assert 'cx="106"' in svg and 'cx="128"' in svg
    assert 'mask-type="alpha"' in svg
    assert "mix-blend-mode:soft-light" in svg


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


def test_fetch_collection_returns_local_cube() -> None:
    import base64

    url = fetch_collection_portrait_url(name="飞坦", avatar_id="abc", color="orange")
    assert url is not None
    svg = base64.b64decode(url.split(",", 1)[1]).decode("utf-8")
    assert f'data-portrait="{PORTRAIT_STYLE}"' in svg
    assert resolve_cube_colorway(avatar_id="abc", name="飞坦")["id"] in svg


def test_fetch_collection_stays_local_when_offline() -> None:
    with patch(
        "agenticx.avatar.portrait.urllib.request.urlopen",
        side_effect=TimeoutError("offline"),
    ):
        url = fetch_collection_portrait_url(name="飞坦", avatar_id="abc")
    assert url is not None
    assert url.startswith("data:image/svg+xml;base64,")


def test_generate_is_local_cube_even_if_fetch_mocked(monkeypatch) -> None:
    import base64

    monkeypatch.setattr(
        "agenticx.avatar.portrait.collection_fetch_enabled",
        lambda: True,
    )
    monkeypatch.setattr(
        "agenticx.avatar.portrait.fetch_collection_portrait_url",
        lambda **_kwargs: _PNG_DATA_URL,
    )
    url = generate_avatar_portrait_url(name="飞坦", role="算法", avatar_id="abc")
    assert url != _PNG_DATA_URL
    svg = base64.b64decode(url.split(",", 1)[1]).decode("utf-8")
    assert f'data-portrait="{PORTRAIT_STYLE}"' in svg


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
    cfg.avatar_url = _GEOMETRIC_FALLBACK_URL
    cfg.portrait_style = ""
    registry._write_config(cfg)
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
    assert needs_portrait_refresh(
        _PNG_DATA_URL, portrait_style=PORTRAIT_STYLE_LEGACY_GENERATED
    ) is True


def test_needs_refresh_migrates_unmarked_png() -> None:
    assert needs_portrait_refresh(_PNG_DATA_URL, portrait_style="") is True
    assert needs_portrait_refresh("", portrait_style="") is True
    cube = generate_avatar_portrait_url(name="离线", avatar_id="offline-1")
    assert is_local_fallback_svg(cube) is False
    assert needs_portrait_refresh(cube, portrait_style=PORTRAIT_STYLE) is False
    assert is_local_fallback_svg(_GEOMETRIC_FALLBACK_URL)
    assert needs_portrait_refresh(_GEOMETRIC_FALLBACK_URL, portrait_style=PORTRAIT_STYLE) is True
    collection_svg = (
        "data:image/svg+xml;base64,"
        "PHN2ZyB2aWV3Qm94PSIwIDAgMTc0NCAxNzQ0Ij48L3N2Zz4="
    )
    assert needs_portrait_refresh(collection_svg, portrait_style=PORTRAIT_STYLE) is False


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


def test_resolve_palette_prefers_explicit_and_matches_desktop_hash() -> None:
    assert resolve_portrait_palette_key(color="rose", avatar_id="3852889fe6c5") == "rose"
    assert resolve_portrait_palette_key(color="blue", avatar_id="3852889fe6c5") == "rose"
    assert resolve_portrait_palette_key(color="", avatar_id="3852889fe6c5") == "rose"
    assert resolve_portrait_palette_key(color="", avatar_id="2027d8ea4ab4") == "sky"


def test_collection_url_keeps_transparent_background() -> None:
    from urllib.parse import parse_qs, urlparse

    url = build_collection_portrait_url(
        name="安全·司南",
        avatar_id="3852889fe6c5",
        color="emerald",
    )
    query = parse_qs(urlparse(url).query)
    assert query["backgroundColor"] == ["transparent"]
    assert "backgroundType" not in query
    assert "/svg" in url
    assert "e8eef2" not in url


def test_cube_ignores_palette_color_and_keeps_colorway() -> None:
    svg = build_avatar_portrait_svg(name="飞坦", avatar_id="abc", color="rose")
    way = resolve_cube_colorway(avatar_id="abc", name="飞坦")
    assert f'data-portrait="{PORTRAIT_STYLE}"' in svg
    assert f'data-colorway="{way["id"]}"' in svg
    assert "#e11d48" not in svg
    assert "rgb(225,29,72)" not in svg


def test_cube_colorway_is_deterministic_and_varied() -> None:
    a = resolve_cube_colorway(avatar_id="id-a", name="测试")
    b = resolve_cube_colorway(avatar_id="id-a", name="测试")
    assert a == b
    ways = {
        resolve_cube_colorway(avatar_id=f"spread-{i}", name="测")["id"]
        for i in range(80)
    }
    assert len(ways) >= 8


def test_resolve_skips_taken_and_derives_when_full() -> None:
    preferred = resolve_cube_colorway(avatar_id="id-a", name="测试")
    alt = resolve_cube_colorway(avatar_id="id-a", name="测试", taken={str(preferred["id"])})
    assert alt["id"] != preferred["id"]
    taken = set(cube_colorway_ids())
    overflow = resolve_cube_colorway(avatar_id="id-a", name="测试", taken=taken)
    assert overflow["id"] not in taken
    assert "~" in str(overflow["id"])
    assert overflow.get("body") != preferred.get("body") or overflow.get("stops") != preferred.get("stops")


def test_cube_catalog_has_no_marble() -> None:
    from agenticx.avatar.portrait import _COLORWAYS

    assert all(str(item["kind"]) != "marble" for item in _COLORWAYS)
    assert "sesame" not in cube_colorway_ids()


def test_resolve_prefers_rich_then_solids() -> None:
    from agenticx.avatar.portrait import _COLORWAYS

    kinds = [
        str(resolve_cube_colorway(avatar_id=f"rich-{i}", name="测")["kind"])
        for i in range(24)
    ]
    assert all(kind != "shade" for kind in kinds)
    rich_only = {str(item["id"]) for item in _COLORWAYS if item["kind"] != "shade"}
    solid = resolve_cube_colorway(avatar_id="after-rich", name="测", taken=rich_only)
    assert solid["kind"] == "shade"
    assert solid["id"] in {"near-orange", "cream", "ink", "mint"}


def test_create_avatars_get_unique_colorways(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("agenticx.avatar.registry.AVATARS_ROOT", tmp_path)
    registry = AvatarRegistry()
    ways = [
        extract_cube_colorway_id(registry.create_avatar(name=f"专家{i}", role="x").avatar_url)
        for i in range(len(cube_colorway_ids()))
    ]
    assert "" not in ways
    assert len(set(ways)) == len(ways)
    extra = registry.create_avatar(name="第22号", role="x")
    extra_way = extract_cube_colorway_id(extra.avatar_url)
    assert extra_way
    assert extra_way not in ways


def test_list_reassigns_duplicate_cube_colorways(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("agenticx.avatar.registry.AVATARS_ROOT", tmp_path)
    registry = AvatarRegistry()
    first = registry.create_avatar(name="程基岩", role="引擎")
    second = registry.create_avatar(name="环境配置专家", role="环境")
    second.avatar_url = first.avatar_url
    second.portrait_style = PORTRAIT_STYLE
    registry._write_config(second)
    assert extract_cube_colorway_id(first.avatar_url) == extract_cube_colorway_id(
        second.avatar_url
    )
    listed = {item.name: item for item in registry.list_avatars()}
    assert extract_cube_colorway_id(listed["程基岩"].avatar_url) != extract_cube_colorway_id(
        listed["环境配置专家"].avatar_url
    )
    assert listed["程基岩"].avatar_url == first.avatar_url


def test_tint_line_art_keeps_white_fills() -> None:
    raw = '<path fill="#000"/><path fill="#fff"/><path fill="black"/>'
    tinted = tint_line_art_svg(raw, portrait_ink_hex(color="orange"))
    assert tinted == '<path fill="#ea580c"/><path fill="#fff"/><path fill="#ea580c"/>'


def test_list_migrates_legacy_v1_portraits(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("agenticx.avatar.registry.AVATARS_ROOT", tmp_path)
    monkeypatch.setattr(
        "agenticx.avatar.registry.collection_fetch_enabled",
        lambda: True,
    )
    monkeypatch.setattr(
        "agenticx.avatar.registry.fetch_collection_portrait_url",
        lambda **_kwargs: "data:image/png;base64,v2",
    )
    registry = AvatarRegistry()
    cfg = registry.create_avatar(name="存量线稿", role="y")
    cfg.avatar_url = "data:image/png;base64,keep-v1"
    cfg.portrait_style = PORTRAIT_STYLE_LEGACY_GENERATED
    registry._write_config(cfg)
    listed = registry.list_avatars()
    assert listed[0].avatar_url == "data:image/png;base64,v2"
    assert listed[0].portrait_style == PORTRAIT_STYLE


def test_update_color_regenerates_generated_portrait(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("agenticx.avatar.registry.AVATARS_ROOT", tmp_path)
    monkeypatch.setattr(
        "agenticx.avatar.registry.generate_avatar_portrait_url",
        lambda **kwargs: f"data:image/png;base64,{kwargs.get('color') or 'hashed'}",
    )
    registry = AvatarRegistry()
    cfg = registry.create_avatar(name="改色", role="x")
    updated = registry.update_avatar(cfg.id, {"color": "violet"})
    assert updated is not None
    assert updated.color == "violet"
    assert updated.avatar_url == "data:image/png;base64,violet"
    assert updated.portrait_style == PORTRAIT_STYLE


def test_near_mark_uses_reserved_dual_not_assigned_to_experts() -> None:
    svg = build_near_mark_svg()
    assert f'data-portrait="{PORTRAIT_STYLE}"' in svg
    assert f'data-colorway="{NEAR_MARK_COLORWAY_ID}"' in svg
    assert "#7C2D12" in svg
    assert "#F97316" in svg
    assert "linearGradient" in svg
    assert NEAR_MARK_COLORWAY_ID not in cube_colorway_ids()
    assigned = {
        resolve_cube_colorway(avatar_id=f"near-spread-{i}", name="Near")["id"]
        for i in range(len(cube_colorway_ids()) + 4)
    }
    assert NEAR_MARK_COLORWAY_ID not in assigned


def test_build_can_force_colorway_id() -> None:
    svg = build_avatar_portrait_svg(
        name="飞坦", avatar_id="abc123", colorway_id="ink-coral"
    )
    assert 'data-colorway="ink-coral"' in svg
    assert "#0F172A" in svg
    assert "#FB7185" in svg


def test_update_color_keeps_custom_upload(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("agenticx.avatar.registry.AVATARS_ROOT", tmp_path)
    registry = AvatarRegistry()
    cfg = registry.create_avatar(name="上传改色", role="x", avatar_url=_PNG_DATA_URL)
    updated = registry.update_avatar(cfg.id, {"color": "amber"})
    assert updated is not None
    assert updated.avatar_url == _PNG_DATA_URL
    assert updated.portrait_style == PORTRAIT_STYLE_CUSTOM
