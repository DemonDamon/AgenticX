#!/usr/bin/env python3
"""OAuth success must respawn CodeBuddy harness children (stale in-proc credentials)."""

from __future__ import annotations

from tests.test_studio_harness_wiring import FakeManager, RecordingAdapter, make_session

pytest_plugins = ("tests.test_studio_harness_wiring",)


def test_refresh_codebuddy_harness_stops_surfaces_and_clears_binding(wiring) -> None:
    hw, _, _, _ = wiring
    cb = RecordingAdapter("codebuddy")
    hw.harness_registry().register(cb)
    session = make_session("studio-oauth-1")
    session.harness_id = "codebuddy"
    manager = FakeManager(session)
    spawned = cb.spawn("/tmp/ws")
    surface_sid = str(spawned["session_id"])
    manager.set_session_harness(
        "studio-oauth-1",
        harness_id="codebuddy",
        surface_session_id=surface_sid,
    )

    out = hw.refresh_codebuddy_harness_after_oauth(manager, "studio-oauth-1")

    assert out.get("ok") is True
    assert surface_sid in (out.get("stopped_surface_ids") or [])
    assert out.get("refreshed_binding") is True
    binding = manager.get_session_harness("studio-oauth-1") or {}
    assert binding.get("harness_session_id") is None
    assert cb.describe(surface_sid) is None


def test_refresh_skips_binding_when_not_codebuddy(wiring) -> None:
    hw, alpha, _, _ = wiring
    hw.harness_registry().register(RecordingAdapter("codebuddy"))
    session = make_session("studio-oauth-2")
    session.harness_id = "alpha"
    manager = FakeManager(session)
    spawned = alpha.spawn("/tmp/ws")
    surface_sid = str(spawned["session_id"])
    manager.set_session_harness(
        "studio-oauth-2",
        harness_id="alpha",
        surface_session_id=surface_sid,
    )

    out = hw.refresh_codebuddy_harness_after_oauth(manager, "studio-oauth-2")

    assert out.get("ok") is True
    assert surface_sid not in (out.get("stopped_surface_ids") or [])
    assert out.get("refreshed_binding") is False
    assert alpha.describe(surface_sid) is not None
