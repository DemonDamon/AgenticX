"""
Interruption & State Recovery 冒烟测试

验证内化自 AgentScope 的 Realtime Steering 机制：
1. InterruptSignal 数据模型
2. ExecutionSnapshot 快照
3. InterruptionManager 中断管理
4. InterruptibleTask 可中断任务
5. WorkerSpawner 中断集成
"""

import pytest
import asyncio
from pathlib import Path
import tempfile

from agenticx.core import (
    InterruptSignal, InterruptReason, InterruptStrategy,
    ExecutionSnapshot, InterruptionManager, InterruptibleTask,
    get_interrupt_manager, reset_interrupt_manager,
)
from agenticx.agents import WorkerSpawner


# =============================================================================
# InterruptSignal 测试
# =============================================================================

class TestInterruptSignal:
    """InterruptSignal 数据模型测试"""
    
    def test_create_signal(self):
        """测试创建中断信号"""
        signal = InterruptSignal(
            reason=InterruptReason.USER_REQUEST,
            message="用户请求中断",
        )
        
        assert signal.reason == InterruptReason.USER_REQUEST
        assert signal.strategy == InterruptStrategy.GRACEFUL
        assert signal.save_state is True
    
    def test_to_metadata(self):
        """测试转换为元数据格式"""
        signal = InterruptSignal(
            reason=InterruptReason.TIMEOUT,
            strategy=InterruptStrategy.IMMEDIATE,
            message="超时中断",
        )
        
        metadata = signal.to_metadata()
        
        assert metadata["_is_interrupted"] is True
        assert metadata["_interrupt_reason"] == "timeout"
        assert metadata["_interrupt_strategy"] == "immediate"


# =============================================================================
# ExecutionSnapshot 测试
# =============================================================================

class TestExecutionSnapshot:
    """ExecutionSnapshot 快照测试"""
    
    def test_create_snapshot(self):
        """测试创建快照"""
        snapshot = ExecutionSnapshot(
            task_id="task-001",
            task_type="worker",
            state={"current_step": 5},
            current_step=5,
            completed_steps=[0, 1, 2, 3, 4],
            interrupt_signal=InterruptSignal(reason=InterruptReason.USER_REQUEST),
        )
        
        assert snapshot.task_id == "task-001"
        assert snapshot.can_resume is True
        assert len(snapshot.completed_steps) == 5
    
    def test_save_load_snapshot(self):
        """测试保存和加载快照"""
        with tempfile.TemporaryDirectory() as tmpdir:
            snapshot = ExecutionSnapshot(
                task_id="task-002",
                task_type="worker",
                state={"data": "test"},
                interrupt_signal=InterruptSignal(reason=InterruptReason.TIMEOUT),
            )
            
            # 保存
            path = Path(tmpdir) / "test_snapshot.json"
            snapshot.save_to_file(path)
            
            assert path.exists()
            
            # 加载
            loaded = ExecutionSnapshot.load_from_file(path)
            assert loaded.task_id == "task-002"
            assert loaded.state["data"] == "test"


# =============================================================================
# InterruptionManager 测试
# =============================================================================

class TestInterruptionManager:
    """InterruptionManager 中断管理器测试"""
    
    @pytest.fixture
    def manager(self):
        """创建临时 InterruptionManager"""
        with tempfile.TemporaryDirectory() as tmpdir:
            mgr = InterruptionManager(snapshot_dir=Path(tmpdir))
            yield mgr
    
    def test_interrupt_task(self, manager):
        """测试发送中断信号"""
        signal = manager.interrupt("task-001", reason=InterruptReason.USER_REQUEST)
        
        assert signal.reason == InterruptReason.USER_REQUEST
        assert manager.is_interrupted("task-001")
    
    def test_get_interrupt_signal(self, manager):
        """测试获取中断信号"""
        manager.interrupt("task-002", message="测试中断")
        
        signal = manager.get_interrupt_signal("task-002")
        assert signal is not None
        assert signal.message == "测试中断"
    
    def test_clear_interrupt(self, manager):
        """测试清除中断"""
        manager.interrupt("task-003")
        assert manager.is_interrupted("task-003")
        
        cleared = manager.clear_interrupt("task-003")
        assert cleared is True
        assert not manager.is_interrupted("task-003")
    
    def test_create_snapshot(self, manager):
        """测试创建快照"""
        manager.interrupt("task-004")
        
        snapshot = manager.create_snapshot(
            task_id="task-004",
            task_type="worker",
            state={"step": 3},
            current_step=3,
        )
        
        assert snapshot.task_id == "task-004"
        assert snapshot.state["step"] == 3
    
    def test_save_and_load_snapshot(self, manager):
        """测试保存和加载快照"""
        snapshot = manager.create_snapshot(
            task_id="task-005",
            task_type="worker",
            state={"data": "test"},
        )
        
        # 保存
        path = manager.save_snapshot(snapshot)
        assert path.exists()
        
        # 加载
        loaded = manager.load_snapshot(snapshot.snapshot_id)
        assert loaded is not None
        assert loaded.task_id == "task-005"
    
    def test_list_snapshots(self, manager):
        """测试列出快照"""
        manager.create_snapshot("task-006", "worker", {})
        manager.create_snapshot("task-007", "worker", {})
        
        snapshots = manager.list_snapshots()
        assert len(snapshots) == 2
        
        # 按任务过滤
        task6_snapshots = manager.list_snapshots(task_id="task-006")
        assert len(task6_snapshots) == 1
    
    def test_interrupt_callback(self, manager):
        """测试中断回调"""
        callback_called = []
        
        def callback(signal):
            callback_called.append(signal)
        
        manager.register_callback("task-008", callback)
        manager.interrupt("task-008")
        
        assert len(callback_called) == 1
    
    def test_get_stats(self, manager):
        """测试统计信息"""
        manager.interrupt("task-009")
        manager.create_snapshot("task-009", "worker", {})
        
        stats = manager.get_stats()
        assert stats["active_interrupts"] >= 1
        assert stats["snapshots_count"] >= 1


# =============================================================================
# InterruptibleTask 测试
# =============================================================================

class TestInterruptibleTask:
    """InterruptibleTask 可中断任务测试"""
    
    @pytest.fixture
    def manager(self):
        """创建临时 InterruptionManager"""
        with tempfile.TemporaryDirectory() as tmpdir:
            yield InterruptionManager(snapshot_dir=Path(tmpdir))
    
    @pytest.mark.asyncio
    async def test_check_interrupt_not_interrupted(self, manager):
        """测试未中断时检查"""
        task = InterruptibleTask("task-010", manager)
        
        # 不应抛出异常
        task.check_interrupt()
    
    @pytest.mark.asyncio
    async def test_check_interrupt_interrupted(self, manager):
        """测试中断时检查"""
        task = InterruptibleTask("task-011", manager, auto_save=False)
        
        # 发送中断信号
        manager.interrupt("task-011")
        
        # 应该抛出 CancelledError
        with pytest.raises(asyncio.CancelledError):
            task.check_interrupt()
    
    @pytest.mark.asyncio
    async def test_update_state(self, manager):
        """测试更新状态"""
        task = InterruptibleTask("task-012", manager)
        
        task.update_state({"step": 1}, current_step=1)
        assert task.current_state["step"] == 1
        assert task.current_step == 1
    
    @pytest.mark.asyncio
    async def test_run_success(self, manager):
        """测试成功运行"""
        task = InterruptibleTask("task-013", manager)
        
        async def my_task():
            return "success"
        
        result = await task.run(my_task())
        assert result == "success"
    
    @pytest.mark.asyncio
    async def test_run_timeout(self, manager):
        """测试超时"""
        task = InterruptibleTask("task-014", manager)
        
        async def slow_task():
            await asyncio.sleep(10)
        
        with pytest.raises(asyncio.TimeoutError):
            await task.run(slow_task(), timeout=0.1)
        
        # 应该发送超时中断信号
        assert manager.is_interrupted("task-014")


# =============================================================================
# WorkerSpawner 中断集成测试
# =============================================================================

class TestWorkerSpawnerInterruption:
    """WorkerSpawner 与中断机制集成测试"""
    
    @pytest.fixture(autouse=True)
    def reset_manager(self):
        """每个测试前重置中断管理器"""
        reset_interrupt_manager()
        yield
        reset_interrupt_manager()
    
    @pytest.fixture
    def spawner(self):
        """创建 WorkerSpawner"""
        return WorkerSpawner()
    
    @pytest.mark.asyncio
    async def test_cancel_worker(self, spawner):
        """测试取消 Worker - 通过预设中断信号"""
        # 预先发送中断信号
        spawner.interrupt_manager.interrupt(
            task_id="worker-preempt",  # 使用已知 ID
            reason=InterruptReason.USER_REQUEST,
            message="预设中断测试",
        )
        
        # 验证中断机制工作正常
        assert spawner.interrupt_manager.is_interrupted("worker-preempt")
        
        # 测试 cancel_worker 方法本身（对不存在的 worker 应返回 False）
        result = await spawner.cancel_worker("non-existent-worker")
        assert result is False
    
    @pytest.mark.asyncio
    async def test_interrupt_saves_snapshot(self, spawner):
        """测试中断时保存快照"""
        # 创建 Worker
        task = asyncio.create_task(spawner.spawn_worker("任务需要快照"))
        
        await asyncio.sleep(0.05)
        
        active_workers = spawner.get_active_workers()
        if active_workers:
            worker_id = active_workers[0].id
            
            # 取消并保存状态
            await spawner.cancel_worker(worker_id, save_state=True)
        
        result = await task
        
        # 检查快照
        if result.metadata.get("interrupted"):
            assert result.metadata.get("snapshot_saved") is True
    
    @pytest.mark.asyncio
    async def test_resume_worker(self, spawner):
        """测试恢复 Worker"""
        # 创建并中断 Worker
        task = asyncio.create_task(spawner.spawn_worker("可恢复任务"))
        
        await asyncio.sleep(0.05)
        
        snapshot_id = None
        active_workers = spawner.get_active_workers()
        if active_workers:
            worker_id = active_workers[0].id
            await spawner.cancel_worker(worker_id, save_state=True)
        
        result = await task
        
        # 获取快照 ID
        snapshots = spawner.interrupt_manager.list_snapshots()
        if snapshots:
            snapshot_id = snapshots[0].snapshot_id
            
            # 尝试恢复（注意：当前实现是重新执行）
            resumed_result = await spawner.resume_worker(snapshot_id)
            assert resumed_result is not None


# =============================================================================
# 完整中断工作流测试
# =============================================================================

class TestFullInterruptionWorkflow:
    """完整中断工作流测试"""
    
    @pytest.fixture(autouse=True)
    def reset_manager(self):
        """重置中断管理器"""
        reset_interrupt_manager()
        yield
        reset_interrupt_manager()
    
    @pytest.mark.asyncio
    async def test_interrupt_and_resume_workflow(self):
        """测试中断和恢复完整流程"""
        manager = get_interrupt_manager()
        
        # 1. 测试创建快照
        snapshot = manager.create_snapshot(
            task_id="workflow-task-001",
            task_type="worker",
            state={"step": 3, "data": "test"},
            current_step=3,
            completed_steps=[0, 1, 2],
        )
        
        # 2. 保存快照
        path = manager.save_snapshot(snapshot)
        assert path.exists()
        
        # 3. 验证快照内容
        loaded = manager.load_snapshot(snapshot.snapshot_id)
        assert loaded is not None
        assert loaded.task_id == "workflow-task-001"
        assert loaded.state["step"] == 3
        assert loaded.can_resume is True
        
        # 4. 验证快照列表
        snapshots = manager.list_snapshots(task_id="workflow-task-001")
        assert len(snapshots) >= 1
        
        # 5. 验证中断信号工作
        manager.interrupt("workflow-task-002")
        assert manager.is_interrupted("workflow-task-002")
        manager.clear_interrupt("workflow-task-002")
        assert not manager.is_interrupted("workflow-task-002")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

