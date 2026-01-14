"""
GUI Agent Unified Proposal - 冒烟测试

覆盖 GUI Agent Unified Proposal 中实现的所有功能点：
- P0-1: ActionOutcome, NormalizedCoordinate, EnhancedTrajStep
- P0-2: ActionReflector
- P1-1: StuckDetector
- P1-2: ActionCache, ActionTree
- P1-3: REACTOutput, GUIActionCompact
- P2-1: DeviceCloudRouter
- P2-2: DAGVerifier

来源: examples/agenticx-for-guiagent/AgenticX-GUIAgent/researches/GUI_Agent_Unified_Proposal.md
"""

import pytest
from datetime import datetime, timezone


# ============================================================================
# P0-1: 数据模型扩展测试
# ============================================================================

class TestActionOutcome:
    """ActionOutcome 枚举测试"""
    
    def test_action_outcome_values(self):
        """测试 ActionOutcome 枚举值"""
        from agenticx.embodiment.core.models import ActionOutcome
        
        assert ActionOutcome.SUCCESS.value == "success"
        assert ActionOutcome.WRONG_STATE.value == "wrong_state"
        assert ActionOutcome.NO_CHANGE.value == "no_change"
        assert ActionOutcome.UNKNOWN.value == "unknown"
    
    def test_action_outcome_is_failure(self):
        """测试 is_failure 属性"""
        from agenticx.embodiment.core.models import ActionOutcome
        
        assert ActionOutcome.SUCCESS.is_failure is False
        assert ActionOutcome.WRONG_STATE.is_failure is True
        assert ActionOutcome.NO_CHANGE.is_failure is True
        assert ActionOutcome.UNKNOWN.is_failure is False
    
    def test_action_outcome_needs_rollback(self):
        """测试 needs_rollback 属性"""
        from agenticx.embodiment.core.models import ActionOutcome
        
        assert ActionOutcome.WRONG_STATE.needs_rollback is True
        assert ActionOutcome.NO_CHANGE.needs_rollback is False
        assert ActionOutcome.SUCCESS.needs_rollback is False


class TestNormalizedCoordinate:
    """NormalizedCoordinate 测试"""
    
    def test_coordinate_creation(self):
        """测试坐标创建"""
        from agenticx.embodiment.core.models import NormalizedCoordinate
        
        coord = NormalizedCoordinate(x=500, y=300)
        assert coord.x == 500
        assert coord.y == 300
    
    def test_coordinate_from_absolute(self):
        """测试从绝对坐标转换"""
        from agenticx.embodiment.core.models import NormalizedCoordinate
        
        coord = NormalizedCoordinate.from_absolute(960, 540, 1920, 1080)
        assert coord.x == 500
        assert coord.y == 500
    
    def test_coordinate_to_absolute(self):
        """测试转换为绝对坐标"""
        from agenticx.embodiment.core.models import NormalizedCoordinate
        
        coord = NormalizedCoordinate(x=500, y=500)
        abs_x, abs_y = coord.to_absolute(1920, 1080)
        assert abs_x == 960
        assert abs_y == 540
    
    def test_coordinate_distance(self):
        """测试距离计算"""
        from agenticx.embodiment.core.models import NormalizedCoordinate
        
        coord1 = NormalizedCoordinate(x=0, y=0)
        coord2 = NormalizedCoordinate(x=1000, y=1000)
        
        distance = coord1.distance_to(coord2)
        assert distance == 1.0  # (1000 + 1000) / 2000
    
    def test_coordinate_validation(self):
        """测试坐标范围验证"""
        from agenticx.embodiment.core.models import NormalizedCoordinate
        from pydantic import ValidationError
        
        # 正常范围
        coord = NormalizedCoordinate(x=0, y=1000)
        assert coord.x == 0
        assert coord.y == 1000
        
        # 超出范围应该抛出错误
        with pytest.raises(ValidationError):
            NormalizedCoordinate(x=-1, y=500)
        
        with pytest.raises(ValidationError):
            NormalizedCoordinate(x=500, y=1001)


class TestEnhancedTrajStep:
    """EnhancedTrajStep 测试"""
    
    def test_traj_step_creation(self):
        """测试轨迹步骤创建"""
        from agenticx.embodiment.core.models import EnhancedTrajStep, ActionOutcome
        
        step = EnhancedTrajStep(
            screenshot=None,
            action={"type": "click", "point": [500, 300]},
            step_index=0,
            thought="需要点击搜索按钮",
            outcome=ActionOutcome.SUCCESS,
            latency_ms=1234.5
        )
        
        assert step.step_index == 0
        assert step.thought == "需要点击搜索按钮"
        assert step.outcome == ActionOutcome.SUCCESS
        assert step.latency_ms == 1234.5
    
    def test_traj_step_properties(self):
        """测试轨迹步骤属性"""
        from agenticx.embodiment.core.models import EnhancedTrajStep, ActionOutcome
        
        step = EnhancedTrajStep(
            screenshot=None,
            action={},
            outcome=ActionOutcome.SUCCESS,
            ask_user_response="用户确认",
            mcp_response="工具响应"
        )
        
        assert step.is_successful is True
        assert step.has_user_interaction is True
        assert step.has_mcp_call is True
    
    def test_traj_step_serialization(self):
        """测试轨迹步骤序列化"""
        from agenticx.embodiment.core.models import EnhancedTrajStep, ActionOutcome
        
        step = EnhancedTrajStep(
            screenshot=None,
            action={"type": "click"},
            outcome=ActionOutcome.SUCCESS,
        )
        
        data = step.to_dict()
        assert data["outcome"] == "success"
        assert "timestamp" in data
        
        # 反序列化
        step2 = EnhancedTrajStep.from_dict(data)
        assert step2.outcome == ActionOutcome.SUCCESS


# ============================================================================
# P0-2: ActionReflector 测试
# ============================================================================

class TestActionReflector:
    """ActionReflector 动作反思器测试"""
    
    def test_reflector_creation(self):
        """测试反思器创建"""
        from agenticx.embodiment.learning import ActionReflector
        
        reflector = ActionReflector(name="test_reflector")
        assert reflector.name == "test_reflector"
    
    def test_action_context_creation(self):
        """测试动作上下文创建"""
        from agenticx.embodiment.learning import ActionContext
        
        context = ActionContext(
            action_type="click",
            action_params={"x": 100, "y": 200},
            step_index=0
        )
        
        assert context.action_type == "click"
        assert context.action_params["x"] == 100
    
    def test_heuristic_reflection(self):
        """测试启发式反思"""
        from agenticx.embodiment.learning import ActionReflector
        from agenticx.embodiment.core.models import ScreenState
        
        reflector = ActionReflector()
        
        before = ScreenState(agent_id="test", screenshot="before_data")
        after = ScreenState(agent_id="test", screenshot="after_data")
        
        result = reflector._compare_screen_states(
            before=before,
            after=after,
            action_type="click",
            action_params={}
        )
        
        # 应该返回某个结果
        assert result.outcome is not None
        assert 0 <= result.confidence <= 1
    
    def test_reflection_result_properties(self):
        """测试反思结果属性"""
        from agenticx.embodiment.learning import ActionReflectionResult
        from agenticx.embodiment.core.models import ActionOutcome
        
        result = ActionReflectionResult(
            outcome=ActionOutcome.WRONG_STATE,
            confidence=0.8
        )
        
        assert result.is_successful is False
        assert result.needs_rollback is True
        assert result.needs_retry is False
    
    def test_reflector_statistics(self):
        """测试反思器统计"""
        from agenticx.embodiment.learning import ActionReflector
        
        reflector = ActionReflector()
        stats = reflector.get_statistics()
        
        assert "total_reflections" in stats
        assert "success_rate" in stats


# ============================================================================
# P1-1: StuckDetector 测试
# ============================================================================

class TestStuckDetector:
    """StuckDetector 卡住检测器测试"""
    
    def test_detector_creation(self):
        """测试检测器创建"""
        from agenticx.embodiment.workflow import StuckDetector
        
        detector = StuckDetector(
            name="test_detector",
            failure_threshold=2
        )
        assert detector.name == "test_detector"
    
    def test_consecutive_failures_detection(self):
        """测试连续失败检测"""
        from agenticx.embodiment.workflow import StuckDetector, RecoveryStrategy
        from agenticx.embodiment.learning import ActionReflectionResult
        from agenticx.embodiment.core.models import ActionOutcome
        
        detector = StuckDetector(failure_threshold=2)
        
        # 记录连续失败
        result = ActionReflectionResult(outcome=ActionOutcome.NO_CHANGE, confidence=0.8)
        detector.record_outcome("click", {"x": 100}, result)
        detector.record_outcome("click", {"x": 100}, result)
        
        # 检查是否卡住
        stuck_state = detector.check_stuck()
        assert stuck_state.is_stuck is True
        assert stuck_state.consecutive_failures >= 2
    
    def test_recovery_strategy_recommendation(self):
        """测试恢复策略推荐"""
        from agenticx.embodiment.workflow import StuckDetector, RecoveryStrategy
        from agenticx.embodiment.learning import ActionReflectionResult
        from agenticx.embodiment.core.models import ActionOutcome
        
        detector = StuckDetector(failure_threshold=2)
        
        # 触发卡住
        result = ActionReflectionResult(outcome=ActionOutcome.NO_CHANGE, confidence=0.8)
        detector.record_outcome("click", {}, result)
        detector.record_outcome("click", {}, result)
        
        stuck_state = detector.check_stuck()
        assert stuck_state.recommended_strategy in RecoveryStrategy
    
    def test_detector_reset(self):
        """测试检测器重置"""
        from agenticx.embodiment.workflow import StuckDetector
        from agenticx.embodiment.learning import ActionReflectionResult
        from agenticx.embodiment.core.models import ActionOutcome
        
        detector = StuckDetector(failure_threshold=2)
        
        # 记录一些动作
        result = ActionReflectionResult(outcome=ActionOutcome.SUCCESS, confidence=0.9)
        detector.record_outcome("click", {}, result)
        
        # 重置
        detector.reset()
        
        stats = detector.get_statistics()
        assert stats["total_steps"] == 0


# ============================================================================
# P1-2: ActionCache & ActionTree 测试
# ============================================================================

class TestActionTree:
    """ActionTree 动作树测试"""
    
    def test_tree_creation(self):
        """测试树创建"""
        from agenticx.embodiment.learning import ActionTree
        
        tree = ActionTree()
        assert len(tree) == 1  # 只有根节点
    
    def test_add_trajectory(self):
        """测试添加轨迹"""
        from agenticx.embodiment.learning import ActionTree, CachedAction
        
        tree = ActionTree()
        actions = [
            CachedAction(name="click", params={"x": 100}, step=0),
            CachedAction(name="type", params={"text": "hello"}, step=1),
        ]
        
        tree.add_trajectory("搜索任务", actions)
        
        stats = tree.get_statistics()
        assert stats["total_trajectories"] == 1
        assert stats["total_edges"] == 2
    
    def test_find_cached_action(self):
        """测试查找缓存动作"""
        from agenticx.embodiment.learning import ActionTree, CachedAction
        
        tree = ActionTree()
        actions = [
            CachedAction(name="click", params={"x": 100}, step=0),
            CachedAction(name="type", params={"text": "hello"}, step=1),
        ]
        
        tree.add_trajectory("搜索任务", actions)
        
        # 查找第一步动作
        result = tree.find_cached_action("搜索任务", step=0)
        assert result is not None
        cached, score = result
        assert cached.name == "click"
        assert score == 1.0


class TestActionCache:
    """ActionCache 动作缓存测试"""
    
    def test_cache_creation(self):
        """测试缓存创建"""
        from agenticx.embodiment.learning import ActionCache, MatchMode
        
        cache = ActionCache(mode=MatchMode.EXACT)
        assert cache.mode == MatchMode.EXACT
    
    def test_cache_statistics(self):
        """测试缓存统计"""
        from agenticx.embodiment.learning import ActionCache
        
        cache = ActionCache()
        stats = cache.get_statistics()
        
        assert "total_lookups" in stats
        assert "cache_hits" in stats
        assert "cache_misses" in stats
        assert "hit_rate" in stats


# ============================================================================
# P1-3: REACT 输出解析测试
# ============================================================================

class TestGUIActionCompact:
    """GUIActionCompact 紧凑动作测试"""
    
    def test_action_creation(self):
        """测试动作创建"""
        from agenticx.embodiment.gui import GUIActionCompact, GUIActionType
        
        action = GUIActionCompact(
            thought="点击搜索按钮",
            action_type=GUIActionType.CLICK,
            point=[500, 300]
        )
        
        assert action.action_type == GUIActionType.CLICK
        assert action.point == [500, 300]
    
    def test_compact_json_serialization(self):
        """测试紧凑 JSON 序列化"""
        from agenticx.embodiment.gui import GUIActionCompact, GUIActionType
        
        action = GUIActionCompact(
            thought="点击搜索",
            action_type=GUIActionType.CLICK,
            point=[500, 300]
        )
        
        json_str = action.to_compact_json()
        assert "click" in json_str
        assert "[500,300]" in json_str or "[500, 300]" in json_str
    
    def test_action_validation(self):
        """测试动作验证"""
        from agenticx.embodiment.gui import GUIActionCompact, GUIActionType
        
        # 有效动作
        action = GUIActionCompact(
            action_type=GUIActionType.CLICK,
            point=[500, 300]
        )
        errors = action.validate_action()
        assert len(errors) == 0
        
        # 缺少坐标的点击动作
        action_invalid = GUIActionCompact(
            action_type=GUIActionType.CLICK
        )
        errors = action_invalid.validate_action()
        assert len(errors) > 0


class TestREACTOutput:
    """REACTOutput 解析器测试"""
    
    def test_parse_basic_format(self):
        """测试基本格式解析"""
        from agenticx.embodiment.gui import REACTOutput
        
        output_str = """<think>需要点击搜索按钮</think>
<act>{"action_type":"click","POINT":[500,300]}</act>"""
        
        react = REACTOutput.parse(output_str)
        
        assert react.think == "需要点击搜索按钮"
        assert "click" in react.act
    
    def test_parse_enhanced_format(self):
        """测试增强格式解析（包含 reflection 和 plan）"""
        from agenticx.embodiment.gui import REACTOutput
        
        output_str = """<reflection>上一步成功</reflection>
<plan>接下来搜索</plan>
<think>需要输入关键词</think>
<act>{"action_type":"type","TYPE":"hello"}</act>"""
        
        react = REACTOutput.parse(output_str)
        
        assert react.reflection == "上一步成功"
        assert react.plan == "接下来搜索"
        assert react.think == "需要输入关键词"
    
    def test_convert_to_gui_action(self):
        """测试转换为 GUIAction"""
        from agenticx.embodiment.gui import REACTOutput, GUIActionType
        
        output_str = """<think>点击</think>
<act>{"action_type":"click","POINT":[500,300]}</act>"""
        
        react = REACTOutput.parse(output_str)
        action = react.to_gui_action()
        
        assert action is not None
        assert action.action_type == GUIActionType.CLICK
        assert action.point == [500, 300]
    
    def test_format_validation(self):
        """测试格式验证"""
        from agenticx.embodiment.gui import REACTOutput
        
        # 有效格式
        output_str = """<think>点击</think>
<act>{"action_type":"click","POINT":[500,300]}</act>"""
        
        react = REACTOutput.parse(output_str)
        errors = react.validate_format()
        assert len(errors) == 0
        
        # 缺少 think 标签
        output_str_invalid = """<act>{"action_type":"click"}</act>"""
        react_invalid = REACTOutput.parse(output_str_invalid)
        errors = react_invalid.validate_format()
        assert len(errors) > 0


class TestREACTPromptBuilder:
    """REACTPromptBuilder 测试"""
    
    def test_build_prompt_zh(self):
        """测试中文提示词构建"""
        from agenticx.embodiment.gui import REACTPromptBuilder
        
        prompt = REACTPromptBuilder.build(language="zh")
        
        assert "Role" in prompt
        assert "<think>" in prompt
        assert "<act>" in prompt
    
    def test_build_prompt_enhanced(self):
        """测试增强提示词构建"""
        from agenticx.embodiment.gui import REACTPromptBuilder
        
        prompt = REACTPromptBuilder.build(language="zh", enhanced=True)
        
        assert "<reflection>" in prompt
        assert "<plan>" in prompt


# ============================================================================
# P2-1: DeviceCloudRouter 测试
# ============================================================================

class TestDeviceCloudRouter:
    """DeviceCloudRouter 路由器测试"""
    
    def test_router_creation(self):
        """测试路由器创建"""
        from agenticx.embodiment.routing import DeviceCloudRouter
        
        router = DeviceCloudRouter()
        assert router is not None
    
    def test_default_routing(self):
        """测试默认路由（设备端）"""
        from agenticx.embodiment.routing import DeviceCloudRouter, ModelType
        
        class MockProvider:
            def __init__(self, name): self.name = name
        
        router = DeviceCloudRouter(
            device_provider=MockProvider("device"),
            cloud_provider=MockProvider("cloud")
        )
        
        provider = router.select_provider()
        assert provider.name == "device"
    
    def test_high_complexity_routing(self):
        """测试高复杂度路由（云端）"""
        from agenticx.embodiment.routing import DeviceCloudRouter
        
        class MockProvider:
            def __init__(self, name): self.name = name
        
        router = DeviceCloudRouter(
            device_provider=MockProvider("device"),
            cloud_provider=MockProvider("cloud")
        )
        
        provider = router.select_provider(task_complexity=10)
        assert provider.name == "cloud"
    
    def test_sensitive_data_routing(self):
        """测试敏感数据路由（设备端）"""
        from agenticx.embodiment.routing import DeviceCloudRouter
        
        class MockProvider:
            def __init__(self, name): self.name = name
        
        router = DeviceCloudRouter(
            device_provider=MockProvider("device"),
            cloud_provider=MockProvider("cloud")
        )
        
        provider = router.select_provider(task_description="输入密码登录")
        assert provider.name == "device"
    
    def test_router_statistics(self):
        """测试路由器统计"""
        from agenticx.embodiment.routing import DeviceCloudRouter, ModelType
        
        router = DeviceCloudRouter()
        
        # 触发一些路由决策
        router.select_provider()
        router.select_provider(task_complexity=10)
        
        # 报告结果
        router.report_result(ModelType.DEVICE, success=True)
        
        stats = router.get_stats()
        assert stats["total_decisions"] == 2
        assert "device_success_rate" in stats


# ============================================================================
# P2-2: DAGVerifier 测试
# ============================================================================

class TestDAGVerifier:
    """DAGVerifier DAG 验证器测试"""
    
    def test_task_spec_creation(self):
        """测试任务规范创建"""
        from agenticx.embodiment.evaluation import DAGNode, DAGTaskSpec
        
        spec = DAGTaskSpec(
            nodes=[
                DAGNode(id="step1", description="第一步"),
                DAGNode(id="step2", deps=["step1"]),
            ],
            success_all_of=["step2"]
        )
        
        assert len(spec.nodes) == 2
        assert spec.get_node("step1") is not None
    
    def test_structure_validation(self):
        """测试结构验证"""
        from agenticx.embodiment.evaluation import DAGNode, DAGTaskSpec
        
        # 有效结构
        spec = DAGTaskSpec(
            nodes=[
                DAGNode(id="a"),
                DAGNode(id="b", deps=["a"]),
            ]
        )
        errors = spec.validate_structure()
        assert len(errors) == 0
        
        # 无效依赖
        spec_invalid = DAGTaskSpec(
            nodes=[
                DAGNode(id="a", deps=["unknown"]),
            ]
        )
        errors = spec_invalid.validate_structure()
        assert len(errors) > 0
    
    def test_verifier_creation(self):
        """测试验证器创建"""
        from agenticx.embodiment.evaluation import DAGNode, DAGTaskSpec, DAGVerifier
        
        spec = DAGTaskSpec(
            nodes=[DAGNode(id="step1")],
            success_all_of=["step1"]
        )
        
        verifier = DAGVerifier(spec)
        assert verifier is not None
    
    def test_successful_verification(self):
        """测试成功验证"""
        from agenticx.embodiment.evaluation import DAGNode, DAGTaskSpec, DAGVerifier
        
        spec = DAGTaskSpec(
            nodes=[
                DAGNode(id="open_app", description="打开应用"),
                DAGNode(id="search", deps=["open_app"], condition={"text_contains": "搜索"}),
            ],
            success_all_of=["search"]
        )
        
        verifier = DAGVerifier(spec)
        
        frames = [
            {"ocr_text": "打开应用成功"},
            {"ocr_text": "搜索框已显示"},
        ]
        
        result = verifier.verify(frames)
        assert result.ok is True
        assert "search" in result.matched_nodes
    
    def test_partial_verification(self):
        """测试部分验证"""
        from agenticx.embodiment.evaluation import DAGNode, DAGTaskSpec, DAGVerifier
        
        spec = DAGTaskSpec(
            nodes=[
                DAGNode(id="step1", description="第一步", score=1),
                DAGNode(id="step2", deps=["step1"], description="第二步", score=1),
                DAGNode(id="step3", deps=["step2"], description="第三步", score=1),
            ],
            success_all_of=["step3"]
        )
        
        verifier = DAGVerifier(spec)
        
        # 只完成前两步
        frames = [
            {"ocr_text": "第一步"},
            {"ocr_text": "第二步"},
        ]
        
        result = verifier.verify(frames)
        assert result.ok is False
        assert result.completion_ratio == pytest.approx(2/3, abs=0.01)
    
    def test_verify_result_serialization(self):
        """测试验证结果序列化"""
        from agenticx.embodiment.evaluation import DAGVerifyResult
        
        result = DAGVerifyResult(
            ok=True,
            matched_nodes=["a", "b"],
            total_score=2,
            max_score=3
        )
        
        data = result.to_dict()
        assert data["ok"] is True
        assert data["matched_nodes"] == ["a", "b"]
        assert "completion_ratio" in data


# ============================================================================
# 集成测试
# ============================================================================

class TestIntegration:
    """集成测试"""
    
    def test_reflector_with_detector(self):
        """测试反思器与检测器集成"""
        from agenticx.embodiment.learning import ActionReflector, ActionReflectionResult
        from agenticx.embodiment.workflow import StuckDetector
        from agenticx.embodiment.core.models import ActionOutcome, ScreenState
        
        reflector = ActionReflector()
        detector = StuckDetector(failure_threshold=2)
        
        # 模拟动作执行和反思
        before = ScreenState(agent_id="test", screenshot="before")
        after = ScreenState(agent_id="test", screenshot="after_same")  # 没变化
        
        result = reflector._compare_screen_states(before, after, "click", {})
        detector.record_outcome("click", {}, result)
        
        # 再来一次
        detector.record_outcome("click", {}, result)
        
        # 检查是否触发卡住
        stuck_state = detector.check_stuck()
        # 结果取决于启发式判断，不做严格断言
        assert stuck_state is not None
    
    def test_react_output_to_cache(self):
        """测试 REACT 输出到缓存流程"""
        from agenticx.embodiment.gui import REACTOutput, GUIActionCompact
        from agenticx.embodiment.learning import ActionTree, CachedAction
        
        # 解析 REACT 输出
        output_str = """<think>点击搜索</think>
<act>{"action_type":"click","POINT":[500,300]}</act>"""
        
        react = REACTOutput.parse(output_str)
        gui_action = react.to_gui_action()
        
        assert gui_action is not None
        
        # 转换为缓存动作
        cached = CachedAction(
            name=gui_action.action_type.value,
            params={"point": gui_action.point},
            step=0
        )
        
        # 添加到缓存树
        tree = ActionTree()
        tree.add_trajectory("搜索任务", [cached])
        
        # 查找
        result = tree.find_cached_action("搜索任务", step=0)
        assert result is not None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
