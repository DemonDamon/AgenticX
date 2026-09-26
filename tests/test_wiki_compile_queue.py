"""Wiki compile stays off the ingest worker and records a visible status."""

import time

from agenticx.brain.wiki_compile_queue import WikiCompileQueue, schedule_wiki_after_ingest
from agenticx.studio.kb.contracts import IngestJobStatus


class _Job:
    def __init__(self, status, document_id):
        self.status = status
        self.document_id = document_id


class _Doc:
    def __init__(self):
        self.source_name = "talk.pdf"


class _Runtime:
    def get_document(self, _doc_id):
        return _Doc()


class _Config:
    class _Wiki:
        enabled = False

    wiki_compiler = _Wiki()


class _Brain:
    def __init__(self):
        self.runtime = _Runtime()
        self.wiki_compiles = WikiCompileQueue()

    def read_config(self):
        return _Config()


def test_disabled_compile_is_visible_and_does_not_queue_work():
    brain = _Brain()
    schedule_wiki_after_ingest(brain, _Job(IngestJobStatus.DONE, "doc-1"))
    rows = brain.wiki_compiles.list_status()
    assert rows[0]["status"] == "skipped"
    assert rows[0]["message"] == "Wiki 编译未打开"


def test_failed_compile_is_recorded_on_the_wiki_queue():
    queue = WikiCompileQueue()

    class _Broken:
        runtime = _Runtime()

        def read_config(self):
            raise RuntimeError("model unavailable")

    queue.enqueue(_Broken(), "doc-2", "talk.pdf")
    deadline = time.time() + 2
    status = ""
    while time.time() < deadline:
        rows = queue.list_status()
        status = rows[0]["status"] if rows else ""
        if status in {"failed", "done"}:
            break
        time.sleep(0.05)
    assert status == "failed"
    assert "model unavailable" in queue.list_status()[0]["message"]


def test_cancel_queued_compile_does_not_stay_running():
    queue = WikiCompileQueue()
    queue.note("doc-3", "talk.pdf", "queued", "等待写页面", stage="queued")
    cancelled = queue.cancel("doc-3")
    assert cancelled == ["doc-3"]
    assert queue.list_status()[0]["status"] == "cancelled"
