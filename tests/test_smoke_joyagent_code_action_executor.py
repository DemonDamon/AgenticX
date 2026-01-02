from agenticx.core.code_action_executor import CodeActionExecutor


def test_code_action_executor_happy_path():
    tools = {"add": lambda x, y: x + y}
    execu = CodeActionExecutor(tools=tools)
    code = "result = tools['add'](2, 3)"
    res = execu.execute(code)
    assert res.success is True
    assert res.result == 5


def test_code_action_executor_block_import():
    execu = CodeActionExecutor()
    res = execu.execute("import os\nresult = 1")
    assert res.success is False
    assert "import" in res.error


def test_code_action_executor_timeout():
    import time
    # 用可控耗时任务代替无限循环，避免线程无法终止导致测试卡住
    tools = {"sleep": time.sleep}
    execu = CodeActionExecutor(tools=tools, timeout_sec=0.2)
    res = execu.execute("tools['sleep'](5)")  # 5秒，但超时0.2秒
    assert res.success is False
    assert "timed out" in res.error


def test_code_action_executor_length_guard():
    execu = CodeActionExecutor(max_code_len=10)
    res = execu.execute("x=" + "1" * 20)
    assert res.success is False
    assert "code too long" in res.error

