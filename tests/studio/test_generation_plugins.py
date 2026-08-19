from agenticx.studio.generation_plugins import GenerationPlugin, mapped_task_response, resolve_video_payload


def _plugin(**kwargs):
    return GenerationPlugin(
        plugin_id="video-generation",
        display_name="视频生成",
        provider="custom_video",
        model="video-model",
        submit_url="https://example.test/generate",
        **kwargs,
    )


def test_video_payload_uses_defaults_and_current_images_only():
    body = resolve_video_payload(
        _plugin(),
        prompt="一个微笑的苹果在唱歌",
        image_urls=["data:image/png;base64,abc"],
    )

    assert body == {
        "model": "video-model",
        "content": [
            {"type": "text", "text": "一个微笑的苹果在唱歌"},
            {"type": "image_url", "url": "data:image/png;base64,abc"},
        ],
        "resolution": "480p",
        "ratio": "16:9",
        "duration": 5,
        "watermark": False,
    }


def test_video_payload_explicit_params_override_plugin_and_builtin_defaults():
    body = resolve_video_payload(
        _plugin(defaults={"resolution": "720p", "duration": 8}),
        prompt="test",
        image_urls=[],
        params={"duration": 10, "watermark": True},
    )

    assert body["resolution"] == "720p"
    assert body["ratio"] == "16:9"
    assert body["duration"] == 10
    assert body["watermark"] is True


def test_response_mapping_never_requires_vendor_specific_shape():
    parsed = mapped_task_response(
        _plugin(response_mapping={"task_id": "data.id", "progress": "data.percent", "result_url": "data.video"}),
        {"data": {"id": "task-1", "percent": 62, "video": "https://example.test/video.mp4"}},
    )

    assert parsed["task_id"] == "task-1"
    assert parsed["progress"] == 62
    assert parsed["result_url"] == "https://example.test/video.mp4"
