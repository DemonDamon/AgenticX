from pathlib import Path

from agenticx.runtime.team_manager import AgentTeamManager


def _mgr() -> AgentTeamManager:
    return AgentTeamManager.__new__(AgentTeamManager)


def _cp_messages(dst_dir: str) -> list:
    return [
        {
            "role": "assistant",
            "tool_calls": [
                {
                    "function": {
                        "name": "bash_exec",
                        "arguments": f'{{"command": "cp /src/a.pdf {dst_dir}/a.pdf"}}',
                    }
                }
            ],
        },
    ]


def test_cp_target_detected(tmp_path):
    dst = tmp_path / "out"
    dst.mkdir()
    (dst / "a.pdf").write_text("x")
    m = _mgr()
    paths = m._extract_bash_copy_paths(_cp_messages(str(dst)), str(tmp_path))
    assert any(str(dst / "a.pdf") in p or p.endswith("a.pdf") for p in paths)


def test_paths_from_text(tmp_path):
    f = tmp_path / "评估报告.md"
    f.write_text("ok")
    m = _mgr()
    text = f"评估已保存到 {f} 完成。"
    got = m._extract_paths_from_text(text)
    assert str(f) in got


def test_write_action_keeps_completed(tmp_path):
    m = _mgr()
    msgs = _cp_messages(str(tmp_path))
    (tmp_path / "a.pdf").write_text("x")
    assert m._had_write_or_copy_action(msgs) is True


def test_true_empty_still_fails():
    m = _mgr()
    assert m._had_write_or_copy_action([{"role": "assistant", "content": "done"}]) is False


def test_declared_output_path_extracted_zh():
    m = _mgr()
    task = (
        "4. 输出评估报告到 /Users/damon/Desktop/Ai产研管理/招聘/20260706/筛选后/产品经理/评估报告.md"
    )
    paths = m._extract_declared_output_paths(task)
    assert paths == [
        "/Users/damon/Desktop/Ai产研管理/招聘/20260706/筛选后/产品经理/评估报告.md"
    ]


def test_declared_output_path_extracted_en():
    m = _mgr()
    task = "Please save it to /tmp/out/report.md when done."
    paths = m._extract_declared_output_paths(task)
    assert paths == ["/tmp/out/report.md"]


def test_declared_output_path_missing_forces_failed(tmp_path):
    m = _mgr()
    task = f"输出评估报告到 {tmp_path}/missing/评估报告.md"
    paths = m._extract_declared_output_paths(task)
    assert paths and not Path(paths[0]).expanduser().exists()


def test_declared_output_path_present_when_written(tmp_path):
    target = tmp_path / "评估报告.md"
    target.write_text("ok")
    m = _mgr()
    task = f"输出评估报告到 {target}"
    paths = m._extract_declared_output_paths(task)
    assert paths and Path(paths[0]).expanduser().exists()


def test_seed_session_history_copies_messages():
    from agenticx.runtime.team_manager import AgentTeamManager, SubAgentContext
    from agenticx.cli.studio import StudioSession

    prior_messages = [
        {"role": "user", "content": "task"},
        {"role": "assistant", "content": "解析了简历A：评分8分"},
    ]
    ctx = SubAgentContext(
        agent_id="sa-test", name="t", role="worker", task="read docs",
        agent_messages=prior_messages,
    )
    session = StudioSession()
    AgentTeamManager._seed_session_history(session, ctx)
    assert session.agent_messages == prior_messages
    session.agent_messages.append({"role": "user", "content": "extra"})
    assert len(ctx.agent_messages) == 2


def test_seed_session_history_noop_when_empty():
    from agenticx.runtime.team_manager import AgentTeamManager, SubAgentContext
    from agenticx.cli.studio import StudioSession

    ctx = SubAgentContext(agent_id="sa-test2", name="t", role="worker", task="read docs")
    session = StudioSession()
    original = session.agent_messages
    AgentTeamManager._seed_session_history(session, ctx)
    assert session.agent_messages == original


def test_retry_and_escalation_task_mention_prior_progress():
    import inspect
    from agenticx.runtime.team_manager import AgentTeamManager

    source = inspect.getsource(AgentTeamManager._auto_escalate)
    assert source.count("已包含此前的工作进度") == 2


def test_max_escalation_default_is_1(monkeypatch):
    from agenticx.runtime import team_manager as tm

    monkeypatch.delenv("AGX_SUBAGENT_MAX_ESCALATION", raising=False)
    assert tm._resolve_max_escalation() == 1


def test_max_escalation_env_override(monkeypatch):
    from agenticx.runtime import team_manager as tm

    monkeypatch.setenv("AGX_SUBAGENT_MAX_ESCALATION", "5")
    assert tm._resolve_max_escalation() == 5


def test_subagent_prompt_incremental_record_guidance():
    from agenticx.runtime.team_manager import SubAgentContext
    from agenticx.cli.studio import StudioSession

    m = _mgr()
    ctx = SubAgentContext(agent_id="sa-test", name="t", role="worker", task="read docs")
    session = StudioSession()
    m.base_session = session
    prompt = m._build_subagent_system_prompt(ctx, session)
    assert "每处理完一份就立即记录" in prompt
