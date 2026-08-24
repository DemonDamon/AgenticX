from agenticx.studio.generation_plugins import (
    GenerationPlugin,
    mapped_task_response,
    resolve_video_payload,
    sync_generation_task_agent_messages,
    sync_generation_tasks_from_history,
)


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
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}},
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


def test_video_payload_promotes_pasted_image_url_to_reference_image():
    body = resolve_video_payload(
        _plugin(),
        prompt="https://example.test/reference.jpg?width=1120 生成一个微笑的苹果在唱歌",
        image_urls=[],
    )

    assert body["content"] == [
        {"type": "text", "text": "生成一个微笑的苹果在唱歌"},
        {"type": "image_url", "image_url": {"url": "https://example.test/reference.jpg?width=1120"}},
    ]


def test_video_payload_promotes_markdown_image_link_without_leaking_link_syntax():
    body = resolve_video_payload(
        _plugin(),
        prompt="[参考图](https://example.test/reference.jpg) 让画面中的人物自然移动",
        image_urls=[],
    )

    assert body["content"] == [
        {"type": "text", "text": "让画面中的人物自然移动"},
        {"type": "image_url", "image_url": {"url": "https://example.test/reference.jpg"}},
    ]


def test_response_mapping_never_requires_vendor_specific_shape():
    parsed = mapped_task_response(
        _plugin(response_mapping={"task_id": "data.id", "progress": "data.percent", "result_url": "data.video"}),
        {"data": {"id": "task-1", "percent": 62, "video": "https://example.test/video.mp4"}},
    )

    assert parsed["task_id"] == "task-1"
    assert parsed["progress"] == 62
    assert parsed["result_url"] == "https://example.test/video.mp4"


def test_generation_task_is_mirrored_into_model_context_and_updated_with_result_url():
    task = {
        "task_id": "task-1",
        "status": "submitted",
        "params": {
            "content": [
                {"type": "text", "text": "让画面中的人物自然移动"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}},
            ]
        },
    }
    agent_messages: list[dict] = []

    sync_generation_task_agent_messages(agent_messages, task, prompt="让画面中的人物自然移动")
    assert agent_messages == [
        {"role": "user", "content": "让画面中的人物自然移动"},
        {
            "role": "assistant",
            "content": "[视频生成任务]\n任务 ID: task-1\n状态: submitted\n提示词: 让画面中的人物自然移动\n参考图: 1 张",
        },
    ]

    task.update({"status": "succeeded", "result_url": "https://example.test/video.mp4"})
    sync_generation_task_agent_messages(agent_messages, task, prompt="让画面中的人物自然移动")

    assert len(agent_messages) == 2
    assert "状态: succeeded" in agent_messages[1]["content"]
    assert "视频链接: https://example.test/video.mp4" in agent_messages[1]["content"]


def test_existing_generation_history_is_backfilled_before_a_normal_chat_turn():
    agent_messages: list[dict] = []
    history = [
        {"role": "user", "content": "让画面中的人物自然移动"},
        {
            "role": "assistant",
            "content": "视频生成任务已完成",
            "metadata": {
                "kind": "generation_task",
                "generation_task": {
                    "task_id": "task-existing",
                    "status": "succeeded",
                    "result_url": "https://example.test/existing.mp4",
                    "params": {"content": [{"type": "text", "text": "让画面中的人物自然移动"}]},
                },
            },
        },
    ]

    sync_generation_tasks_from_history(agent_messages, history)

    assert agent_messages[0] == {"role": "user", "content": "让画面中的人物自然移动"}
    assert "任务 ID: task-existing" in agent_messages[1]["content"]
    assert "视频链接: https://example.test/existing.mp4" in agent_messages[1]["content"]
