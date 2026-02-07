import asyncio
import pytest

from agenticx.memory.compaction_flush import (
    CompactionFlushConfig,
    DefaultMemoryFlushHandler,
    MemoryFlushHandler,
)


# ---------------------------------------------------------------------------
# Helper: record calls to the handler for assertion
# ---------------------------------------------------------------------------

class RecordingFlushHandler:
    """A test handler that records calls."""

    def __init__(self):
        self.should_flush_calls: list = []
        self.execute_flush_calls: list = []

    async def should_flush(self, current_tokens, max_tokens, config):
        self.should_flush_calls.append((current_tokens, max_tokens))
        # Always flush when called
        return current_tokens >= (max_tokens - config.soft_threshold_tokens)

    async def execute_flush(self, config):
        self.execute_flush_calls.append(config.flush_prompt)
        return "flushed"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestCompactionFlushConfig:
    """Test configuration defaults."""

    def test_defaults(self):
        cfg = CompactionFlushConfig()
        assert cfg.enabled is True
        assert cfg.soft_threshold_tokens == 1000
        assert cfg.reserve_tokens_floor == 2000
        assert "context window" in cfg.flush_prompt.lower()

    def test_disabled(self):
        cfg = CompactionFlushConfig(enabled=False)
        assert cfg.enabled is False


class TestDefaultMemoryFlushHandler:
    """Test the default handler implementation."""

    def test_should_flush_below_threshold(self):
        handler = DefaultMemoryFlushHandler()
        cfg = CompactionFlushConfig(soft_threshold_tokens=1000)

        result = asyncio.run(handler.should_flush(
            current_tokens=5000, max_tokens=8000, config=cfg
        ))
        # 5000 < 8000-1000=7000 → should NOT flush
        assert result is False

    def test_should_flush_at_threshold(self):
        handler = DefaultMemoryFlushHandler()
        cfg = CompactionFlushConfig(soft_threshold_tokens=1000)

        result = asyncio.run(handler.should_flush(
            current_tokens=7000, max_tokens=8000, config=cfg
        ))
        # 7000 >= 7000 → should flush
        assert result is True

    def test_should_flush_above_threshold(self):
        handler = DefaultMemoryFlushHandler()
        cfg = CompactionFlushConfig(soft_threshold_tokens=1000)

        result = asyncio.run(handler.should_flush(
            current_tokens=7500, max_tokens=8000, config=cfg
        ))
        assert result is True

    def test_should_flush_disabled(self):
        handler = DefaultMemoryFlushHandler()
        cfg = CompactionFlushConfig(enabled=False, soft_threshold_tokens=1000)

        result = asyncio.run(handler.should_flush(
            current_tokens=9999, max_tokens=8000, config=cfg
        ))
        # Disabled → never flush
        assert result is False

    def test_execute_flush_returns_prompt(self):
        handler = DefaultMemoryFlushHandler()
        cfg = CompactionFlushConfig(flush_prompt="CUSTOM PROMPT")

        result = asyncio.run(handler.execute_flush(cfg))
        assert result == "CUSTOM PROMPT"
        assert handler.flush_count == 1

    def test_execute_flush_callback(self):
        captured = []

        async def on_flush(prompt: str):
            captured.append(prompt)
            return "callback_result"

        handler = DefaultMemoryFlushHandler(on_flush=on_flush)
        cfg = CompactionFlushConfig(flush_prompt="TEST")

        result = asyncio.run(handler.execute_flush(cfg))
        assert result == "callback_result"
        assert captured == ["TEST"]
        assert handler.flush_count == 1


class TestRecordingFlushHandler:
    """Verify the recording handler satisfies the Protocol."""

    def test_protocol_compliance(self):
        handler = RecordingFlushHandler()
        # runtime_checkable Protocol check
        assert isinstance(handler, MemoryFlushHandler)

    def test_recording(self):
        handler = RecordingFlushHandler()
        cfg = CompactionFlushConfig(soft_threshold_tokens=500)

        result = asyncio.run(handler.should_flush(7600, 8000, cfg))
        assert result is True
        assert len(handler.should_flush_calls) == 1

        result2 = asyncio.run(handler.execute_flush(cfg))
        assert result2 == "flushed"
        assert len(handler.execute_flush_calls) == 1


class TestContextCompilerFlushIntegration:
    """Test that ContextCompiler calls flush handler before compaction.

    We import ContextCompiler and wire a RecordingFlushHandler to verify the
    integration without needing a real LLM.
    """

    def test_flush_called_before_compact(self):
        """Verify flush handler is invoked during compact()."""
        from agenticx.core.context_compiler import ContextCompiler
        from agenticx.core.event import EventLog, CompactionConfig, TaskStartEvent

        handler = RecordingFlushHandler()
        flush_cfg = CompactionFlushConfig(soft_threshold_tokens=500)
        compact_cfg = CompactionConfig(
            enabled=True,
            compaction_interval=2,
            max_context_tokens=8000,
        )

        compiler = ContextCompiler(
            config=compact_cfg,
            flush_handler=handler,
            flush_config=flush_cfg,
        )

        # Build an event log with enough events to trigger compaction
        elog = EventLog(agent_id="a1", task_id="t1")
        for i in range(5):
            elog.append(TaskStartEvent(
                task_description=f"task {i}",
                agent_id="a1",
                task_id="t1",
            ))

        # Run compact (will invoke _maybe_flush_before_compact internally)
        asyncio.run(compiler.compact(elog))

        # should_flush must have been called at least once
        assert len(handler.should_flush_calls) >= 1

    def test_flush_skipped_when_disabled(self):
        """Flush handler not called when flush_config.enabled=False."""
        from agenticx.core.context_compiler import ContextCompiler
        from agenticx.core.event import EventLog, CompactionConfig, TaskStartEvent

        handler = RecordingFlushHandler()
        flush_cfg = CompactionFlushConfig(enabled=False)
        compact_cfg = CompactionConfig(enabled=True, compaction_interval=2)

        compiler = ContextCompiler(
            config=compact_cfg,
            flush_handler=handler,
            flush_config=flush_cfg,
        )

        elog = EventLog(agent_id="a1", task_id="t1")
        for i in range(5):
            elog.append(TaskStartEvent(
                task_description=f"task {i}",
                agent_id="a1",
                task_id="t1",
            ))

        asyncio.run(compiler.compact(elog))

        # should_flush must NOT have been called
        assert len(handler.should_flush_calls) == 0

    def test_flush_skipped_when_no_handler(self):
        """No crash when flush_handler is None."""
        from agenticx.core.context_compiler import ContextCompiler
        from agenticx.core.event import EventLog, CompactionConfig, TaskStartEvent

        compact_cfg = CompactionConfig(enabled=True, compaction_interval=2)
        compiler = ContextCompiler(config=compact_cfg)

        elog = EventLog(agent_id="a1", task_id="t1")
        for i in range(5):
            elog.append(TaskStartEvent(
                task_description=f"task {i}",
                agent_id="a1",
                task_id="t1",
            ))

        # Should not raise
        asyncio.run(compiler.compact(elog))
        assert compiler.flush_count == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
