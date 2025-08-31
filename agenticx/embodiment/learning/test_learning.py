"""学习引擎模块单元测试

测试所有学习引擎组件的核心功能。
"""

import unittest
import time
from datetime import datetime
from unittest.mock import Mock, patch, MagicMock
from typing import Dict, List, Any

from .models import (
    AppContext, UIPattern, ActionTrace, ComplexTask, TaskPattern, Workflow,
    ExecutionLog, EfficiencyPattern, ExecutionTrace, Anomaly, EdgeCase,
    RecoveryStrategy, Experience, Pattern, KnowledgeConflict, Resolution,
    KnowledgeItem, ValidationResult, EFSM, ReflectionResult,
    TaskComplexity, PatternType, AnomalyType, ConflictType
)
from .app_knowledge_retriever import AppKnowledgeRetriever, DefaultAppKnowledgeRetriever
from .gui_explorer import GUIExplorer, DefaultGUIExplorer
from .task_synthesizer import TaskSynthesizer, DefaultTaskSynthesizer
from .deep_usage_optimizer import DeepUsageOptimizer, DefaultDeepUsageOptimizer, UsageAnalysis, OptimizationResult
from .edge_case_handler import EdgeCaseHandler, DefaultEdgeCaseHandler, EdgeCaseDetectionResult, RecoveryResult
from .knowledge_evolution import KnowledgeEvolution, DefaultKnowledgeEvolution, EvolutionStrategy, ValidationLevel
from agenticx.embodiment.core.models import GUIAction, ScreenState, ActionType, ElementType, InteractionElement, BoundingBox, ElementTree
from agenticx.embodiment.core.agent import GUITask, TaskStatus, ActionResult


class TestLearningModels(unittest.TestCase):
    """测试学习引擎数据模型"""
    
    def test_app_context_creation(self):
        """测试应用上下文创建"""
        context = AppContext(
            app_name="TestApp",
            app_package="com.test.app",
            app_version="1.0.0",
            app_category="Test",
            description="Test application",
            platform="Windows",
            ui_framework="WPF",
            metadata={"test": "data"}
        )
        
        self.assertEqual(context.app_name, "TestApp")
        self.assertEqual(context.app_version, "1.0.0")
        self.assertEqual(context.platform, "Windows")
        self.assertEqual(context.ui_framework, "WPF")
        self.assertIsNotNone(context.context_id)
        
        # 测试to_dict方法
        context_dict = context.to_dict()
        self.assertIsInstance(context_dict, dict)
        self.assertEqual(context_dict["app_name"], "TestApp")
    
    def test_ui_pattern_creation(self):
        """测试UI模式创建"""
        pattern = UIPattern(
            pattern_type=PatternType.LAYOUT,
            elements=["button1", "textbox1"],
            attributes={"layout": "vertical"},
            frequency=5,
            confidence=0.8
        )
        
        self.assertEqual(pattern.pattern_type, PatternType.LAYOUT)
        self.assertEqual(len(pattern.elements), 2)
        self.assertEqual(pattern.frequency, 5)
        self.assertEqual(pattern.confidence, 0.8)
        self.assertIsNotNone(pattern.pattern_id)
    
    def test_action_trace_creation(self):
        """测试动作轨迹创建"""
        # Create mock actions and states
        mock_action = GUIAction(
            action_type=ActionType.CLICK,
            target_element_id="btn1",
            coordinates=(50, 25)
        )
        mock_action = GUIAction(action_type=ActionType.CLICK, target_element_id="test_element")
        mock_result = ActionResult(action=mock_action, success=True)
        # 创建根元素
        root_element = InteractionElement(
            element_id="root",
            element_type=ElementType.CONTAINER,
            bounds=BoundingBox(0, 0, 1920, 1080)
        )
        mock_state = ScreenState(
            timestamp=time.time(),
            screen_size=(1920, 1080),
            orientation="portrait",
            element_tree=ElementTree(root_element=root_element)
        )
        mock_context = AppContext(
            app_package="com.test.app",
            app_name="Test App",
            app_version="1.0",
            app_category="Test",
            description="Test application"
        )
        
        trace = ActionTrace(
            trace_id="test_trace",
            actions=[mock_action],
            results=[mock_result],
            states=[mock_state],
            app_context=mock_context,
            start_time=time.time(),
            success=True
        )
        
        self.assertEqual(len(trace.actions), 1)
        self.assertEqual(len(trace.results), 1)
        self.assertEqual(len(trace.states), 1)
        self.assertTrue(trace.success)
        self.assertIsNotNone(trace.trace_id)
        self.assertEqual(trace.app_context.app_package, "com.test.app")
    
    def test_complex_task_creation(self):
        """测试复杂任务创建"""
        task = ComplexTask(
            task_id="complex_workflow",
            description="Complex Workflow",
            sub_tasks=[],
            action_sequences=[],
            complexity=TaskComplexity.HIGH,
            estimated_time=300.0,
            prerequisites=["task1", "task2"]
        )
        
        self.assertEqual(task.description, "Complex Workflow")
        self.assertEqual(len(task.sub_tasks), 0)
        self.assertEqual(task.complexity, TaskComplexity.HIGH)
        self.assertEqual(task.estimated_time, 300.0)
        self.assertIsNotNone(task.task_id)


class TestAppKnowledgeRetriever(unittest.TestCase):
    """测试应用知识检索器"""
    
    def setUp(self):
        """设置测试环境"""
        self.retriever = DefaultAppKnowledgeRetriever()
        
        # 创建模拟的应用上下文
        self.mock_context = AppContext(
            app_name="TestApp",
            app_package="com.test.app",
            app_version="1.0.0",
            app_category="Test",
            description="Test application",
            platform="Windows",
            ui_framework="WPF"
        )
        
        # 创建模拟的屏幕状态
        # 创建测试元素
        from agenticx.embodiment.core.models import ElementTree, BoundingBox, ElementType
        from agenticx.embodiment.core.agent import ActionResult
        
        btn_element = InteractionElement(
            element_id="btn1",
            element_type=ElementType.BUTTON,
            bounds=BoundingBox(10, 10, 90, 30),
            text="Click Me",
            clickable=True
        )
        
        txt_element = InteractionElement(
            element_id="txt1",
            element_type=ElementType.TEXT_FIELD,
            bounds=BoundingBox(10, 50, 190, 30),
            text="",
            clickable=True
        )
        
        element_tree = ElementTree(
            root_element=btn_element,
            elements={"btn1": btn_element, "txt1": txt_element}
        )
        
        self.mock_screen_state = ScreenState(
            timestamp=time.time(),
            screen_size=(800, 600),
            orientation="portrait",
            element_tree=element_tree,
            screenshot_path="test.png"
        )
    
    def test_extract_app_context(self):
        """测试提取应用上下文"""
        context = self.retriever.extract_app_context(self.mock_screen_state)
        
        self.assertIsInstance(context, AppContext)
        self.assertIsNotNone(context.context_id)
    
    def test_discover_ui_patterns(self):
        """测试发现UI模式"""
        screen_states = [self.mock_screen_state] * 3
        patterns = self.retriever.discover_ui_patterns(screen_states)
        
        self.assertIsInstance(patterns, list)
        for pattern in patterns:
            self.assertIsInstance(pattern, UIPattern)
    
    def test_analyze_interaction_flows(self):
        """测试分析交互流程"""
        # 创建模拟的动作轨迹
        # Create mock actions for trace
        mock_action1 = GUIAction(
            action_type=ActionType.CLICK,
            target_element_id="btn1",
            coordinates=(50, 25)
        )
        mock_action2 = GUIAction(
            action_type=ActionType.TYPE,
            target_element_id="input1",
            text_input="test input",
            coordinates=(100, 75)
        )
        mock_action_for_result1 = GUIAction(action_type=ActionType.CLICK, target_element_id="btn1")
        mock_action_for_result2 = GUIAction(action_type=ActionType.TYPE, target_element_id="input1")
        mock_result1 = ActionResult(action=mock_action_for_result1, success=True)
        mock_result2 = ActionResult(action=mock_action_for_result2, success=True)
        mock_context = AppContext(
            app_package="com.test.app",
            app_name="Test App",
            app_version="1.0",
            app_category="Test",
            description="Test application"
        )
        
        traces = [
            ActionTrace(
                trace_id="trace1",
                actions=[mock_action1, mock_action2],
                results=[mock_result1, mock_result2],
                states=[self.mock_screen_state, self.mock_screen_state],
                app_context=mock_context,
                start_time=time.time(),
                success=True
            )
        ]
        
        flows = self.retriever.analyze_interaction_flows(traces)
        
        self.assertIsInstance(flows, list)
        for flow in flows:
            self.assertIsInstance(flow, dict)
    
    def test_retrieve_similar_contexts(self):
        """测试检索相似上下文"""
        contexts = [self.mock_context] * 3
        similar = self.retriever.retrieve_similar_contexts(self.mock_context, contexts)
        
        self.assertIsInstance(similar, list)
        self.assertLessEqual(len(similar), 3)
    
    def test_extract_knowledge_from_traces(self):
        """测试从轨迹中提取知识"""
        # Create mock actions for trace
        mock_action1 = GUIAction(
            action_type=ActionType.CLICK,
            target_element_id="btn1",
            coordinates=(50, 25)
        )
        mock_action2 = GUIAction(
            action_type=ActionType.TYPE,
            target_element_id="input1",
            text_input="test input",
            coordinates=(100, 75)
        )
        mock_action3 = GUIAction(
            action_type=ActionType.CLICK,
            target_element_id="submit_btn",
            coordinates=(50, 125)
        )
        mock_action1 = GUIAction(action_type=ActionType.CLICK, target_element_id="btn1")
        mock_action2 = GUIAction(action_type=ActionType.TYPE, target_element_id="input1")
        mock_action3 = GUIAction(action_type=ActionType.CLICK, target_element_id="submit_btn")
        mock_result1 = ActionResult(action=mock_action1, success=True)
        mock_result2 = ActionResult(action=mock_action2, success=True)
        mock_result3 = ActionResult(action=mock_action3, success=True)
        mock_context = AppContext(
            app_package="com.test.app",
            app_name="Test App",
            app_version="1.0",
            app_category="Test",
            description="Test application"
        )
        # 创建根元素
        root_element = InteractionElement(
            element_id="root",
            element_type=ElementType.CONTAINER,
            bounds=BoundingBox(0, 0, 1920, 1080)
        )
        mock_state = ScreenState(
            timestamp=time.time(),
            screen_size=(1920, 1080),
            orientation="portrait",
            element_tree=ElementTree(root_element=root_element)
        )
        
        traces = [
            ActionTrace(
                trace_id="trace1",
                actions=[mock_action1, mock_action2, mock_action3],
                results=[mock_result1, mock_result2, mock_result3],
                states=[mock_state, mock_state, mock_state],
                app_context=mock_context,
                start_time=time.time(),
                success=True
            )
        ]
        
        knowledge = self.retriever.extract_knowledge_from_traces(traces)
        
        self.assertIsInstance(knowledge, dict)
        self.assertIn("action_patterns", knowledge)
        self.assertIn("success_patterns", knowledge)


class TestGUIExplorer(unittest.TestCase):
    """测试GUI探索器"""
    
    def setUp(self):
        """设置测试环境"""
        self.explorer = DefaultGUIExplorer()
        
        # 创建模拟的屏幕状态
        # 创建测试元素
        from agenticx.embodiment.core.models import ElementTree, BoundingBox, ElementType
        
        btn_element = InteractionElement(
            element_id="btn1",
            element_type=ElementType.BUTTON,
            bounds=BoundingBox(10, 10, 90, 30),
            text="Click Me",
            clickable=True
        )
        
        txt_element = InteractionElement(
            element_id="txt1",
            element_type=ElementType.TEXT_FIELD,
            bounds=BoundingBox(10, 50, 190, 30),
            text="",
            clickable=True
        )
        
        element_tree = ElementTree(
            root_element=btn_element,
            elements={"btn1": btn_element, "txt1": txt_element}
        )
        
        self.mock_screen_state = ScreenState(
            timestamp=time.time(),
            screen_size=(800, 600),
            orientation="portrait",
            element_tree=element_tree,
            screenshot_path="test.png"
        )
    
    def test_explore_interface(self):
        """测试探索界面"""
        exploration_result = self.explorer.explore_interface(self.mock_screen_state)
        
        self.assertIsInstance(exploration_result, dict)
        self.assertIn("discovered_elements", exploration_result)
        self.assertIn("exploration_actions", exploration_result)
    
    def test_discover_new_elements(self):
        """测试发现新元素"""
        known_elements = [{"id": "btn1", "type": "button"}]
        new_elements = self.explorer.discover_new_elements(self.mock_screen_state, known_elements)
        
        self.assertIsInstance(new_elements, list)
    
    def test_generate_exploration_actions(self):
        """测试生成探索动作"""
        actions = self.explorer.generate_exploration_actions(self.mock_screen_state)
        
        self.assertIsInstance(actions, list)
        for action in actions:
            self.assertIsInstance(action, GUIAction)
    
    def test_build_state_model(self):
        """测试构建状态模型"""
        screen_states = [self.mock_screen_state] * 3
        state_model = self.explorer.build_state_model(screen_states)
        
        self.assertIsInstance(state_model, dict)
        self.assertIn("states", state_model)
        self.assertIn("transitions", state_model)
    
    def test_detect_ui_anomalies(self):
        """测试检测UI异常"""
        anomalies = self.explorer.detect_ui_anomalies(self.mock_screen_state)
        
        self.assertIsInstance(anomalies, list)
        for anomaly in anomalies:
            self.assertIsInstance(anomaly, Anomaly)


class TestTaskSynthesizer(unittest.TestCase):
    """测试任务合成器"""
    
    def setUp(self):
        """设置测试环境"""
        self.synthesizer = DefaultTaskSynthesizer()
        
        # 创建模拟的动作轨迹
        mock_action1 = GUIAction(
            action_type=ActionType.CLICK,
            target_element_id="btn1",
            coordinates=(50, 25)
        )
        mock_action2 = GUIAction(
            action_type=ActionType.TYPE,
            target_element_id="input1",
            text_input="test input",
            coordinates=(100, 75)
        )
        mock_action3 = GUIAction(
            action_type=ActionType.CLICK,
            target_element_id="submit_btn",
            coordinates=(50, 125)
        )
        mock_action1 = GUIAction(action_type=ActionType.CLICK, target_element_id="btn1")
        mock_action2 = GUIAction(action_type=ActionType.TYPE, target_element_id="input1")
        mock_action3 = GUIAction(action_type=ActionType.CLICK, target_element_id="submit_btn")
        mock_result1 = ActionResult(action=mock_action1, success=True)
        mock_result2 = ActionResult(action=mock_action2, success=True)
        mock_result3 = ActionResult(action=mock_action3, success=True)
        mock_context = AppContext(
            app_package="com.test.app",
            app_name="Test App",
            app_version="1.0",
            app_category="Test",
            description="Test application"
        )
        # 创建根元素
        root_element = InteractionElement(
            element_id="root",
            element_type=ElementType.CONTAINER,
            bounds=BoundingBox(0, 0, 1920, 1080)
        )
        mock_state = ScreenState(
            timestamp=time.time(),
            screen_size=(1920, 1080),
            orientation="portrait",
            element_tree=ElementTree(root_element=root_element)
        )
        
        self.mock_traces = [
            ActionTrace(
                trace_id="trace1",
                actions=[mock_action1, mock_action2, mock_action3],
                results=[mock_result1, mock_result2, mock_result3],
                states=[mock_state, mock_state, mock_state],
                app_context=mock_context,
                start_time=time.time(),
                success=True
            )
        ]
    
    def test_synthesize_tasks(self):
        """测试合成任务"""
        synthesis_result = self.synthesizer.synthesize_tasks_from_traces(self.mock_traces)
        tasks = synthesis_result.synthesized_tasks
        
        self.assertIsInstance(tasks, list)
        for task in tasks:
            self.assertIsInstance(task, ComplexTask)
    
    def test_decompose_complex_task(self):
        """测试分解复杂任务"""
        complex_task = ComplexTask(
            task_id="complex_workflow",
            description="Complex Workflow",
            sub_tasks=[],
            action_sequences=[],
            complexity=TaskComplexity.HIGH,
            estimated_time=300.0
        )
        
        subtasks = self.synthesizer.decompose_complex_task(complex_task)
        
        self.assertIsInstance(subtasks, list)
        for subtask in subtasks:
            self.assertIsInstance(subtask, ComplexTask)
    
    def test_identify_task_patterns(self):
        """测试识别任务模式"""
        tasks = [
            ComplexTask(
                task_id="task_1",
                description="Task 1",
                sub_tasks=[],
                action_sequences=[],
                complexity=TaskComplexity.MEDIUM,
                estimated_time=100.0
            )
        ]
        
        patterns = self.synthesizer.identify_task_patterns(tasks)
        
        self.assertIsInstance(patterns, list)
        for pattern in patterns:
            self.assertIsInstance(pattern, TaskPattern)
    
    def test_generate_workflows(self):
        """测试生成工作流"""
        tasks = [
            ComplexTask(
                task_id="task_1",
                description="Task 1",
                sub_tasks=[],
                action_sequences=[],
                complexity=TaskComplexity.MEDIUM,
                estimated_time=100.0
            )
        ]
        
        workflows = self.synthesizer.generate_workflows(tasks)
        
        self.assertIsInstance(workflows, list)
        for workflow in workflows:
            self.assertIsInstance(workflow, Workflow)
    
    def test_optimize_task_sequence(self):
        """测试优化任务序列"""
        tasks = [
            ComplexTask(
                task_id="task_1",
                description="Task 1",
                sub_tasks=[],
                action_sequences=[],
                complexity=TaskComplexity.MEDIUM,
                estimated_time=100.0
            ),
            ComplexTask(
                task_id="task_2",
                description="Task 2",
                sub_tasks=[],
                action_sequences=[],
                complexity=TaskComplexity.LOW,
                estimated_time=50.0
            )
        ]
        
        optimized_sequence = self.synthesizer.optimize_task_sequence(tasks)
        
        self.assertIsInstance(optimized_sequence, list)
        self.assertEqual(len(optimized_sequence), 2)


class TestDeepUsageOptimizer(unittest.TestCase):
    """测试深度使用优化器"""
    
    def setUp(self):
        """设置测试环境"""
        self.optimizer = DefaultDeepUsageOptimizer()
        
        # 创建模拟的执行日志
        mock_action = GUIAction(action_type=ActionType.CLICK, target_element_id="test_element")
        mock_result = ActionResult(action=mock_action, success=True)
        
        self.mock_logs = [
            ExecutionLog(
                log_id="log1",
                task_id="task1",
                actions=[mock_action],
                results=[mock_result],
                execution_time=10.0,
                success=True,
                performance_metrics={"cpu": 20.0, "memory": 100.0}
            )
        ]
    
    def test_analyze_usage_patterns(self):
        """测试分析使用模式"""
        # 创建ExecutionTrace对象而不是ExecutionLog
        mock_traces = [
            ExecutionTrace(
                trace_id="trace1",
                task_id="task1",
                action_sequence=[{"type": "click", "target": "button1"}],
                state_sequence=[],
                result_sequence=[],
                start_time=time.time(),
                end_time=time.time() + 5.0,
                success=True
            )
        ]
        
        patterns = self.optimizer.analyze_usage_patterns(mock_traces)
        
        self.assertIsInstance(patterns, UsageAnalysis)
        self.assertIsInstance(patterns.frequent_patterns, list)
        self.assertIsInstance(patterns.bottlenecks, list)
        self.assertIsInstance(patterns.optimization_opportunities, list)
    
    def test_optimize_workflows(self):
        """测试优化工作流"""
        workflows = [
            Workflow(
                workflow_id="test_workflow_1",
                name="Test Workflow",
                steps=[{"step_id": 1, "name": "step1"}, {"step_id": 2, "name": "step2"}, {"step_id": 3, "name": "step3"}],
                conditions={},
                optimizations=[],
                estimated_time=100.0,
                success_rate=0.8
            )
        ]
        
        optimization_result = self.optimizer.optimize_workflows(workflows)
        
        self.assertIsInstance(optimization_result, OptimizationResult)
        self.assertIsInstance(optimization_result.optimized_workflows, list)
        for workflow in optimization_result.optimized_workflows:
            self.assertIsInstance(workflow, Workflow)
    
    def test_identify_efficiency_patterns(self):
        """测试识别效率模式"""
        traces = [
            ExecutionTrace(
                trace_id="trace1",
                task_id="task1",
                action_sequence=[],
                state_sequence=[],
                result_sequence=[],
                start_time=time.time(),
                end_time=time.time() + 5.0,
                success=True
            )
        ]
        
        patterns = self.optimizer.identify_efficiency_patterns(traces)
        
        self.assertIsInstance(patterns, list)
        for pattern in patterns:
            self.assertIsInstance(pattern, EfficiencyPattern)
    
    def test_optimize_resource_usage(self):
        """测试优化资源使用"""
        resource_data = [
            {"cpu": 50.0, "memory": 200.0, "disk": 10.0},
            {"cpu": 30.0, "memory": 150.0, "disk": 5.0}
        ]
        
        optimization_suggestions = self.optimizer.optimize_resource_usage(resource_data)
        
        self.assertIsInstance(optimization_suggestions, list)
        for suggestion in optimization_suggestions:
            self.assertIsInstance(suggestion, dict)
    
    def test_predict_performance_improvements(self):
        """测试预测性能改进"""
        current_metrics = {"success_rate": 0.8, "avg_time": 10.0}
        optimization_plan = {"strategy": "parallel_execution", "confidence": 0.9}
        
        predictions = self.optimizer.predict_performance_improvements(current_metrics, optimization_plan)
        
        self.assertIsInstance(predictions, dict)
        self.assertIn("predicted_success_rate", predictions)
        self.assertIn("predicted_time_reduction", predictions)


class TestEdgeCaseHandler(unittest.TestCase):
    """测试边缘情况处理器"""
    
    def setUp(self):
        """设置测试环境"""
        self.handler = DefaultEdgeCaseHandler()
        
        # 创建模拟的执行轨迹
        self.mock_traces = [
            ExecutionTrace(
                trace_id="trace1",
                task_id="task1",
                action_sequence=[],
                state_sequence=[],
                result_sequence=[],
                start_time=time.time(),
                end_time=time.time() + 30.0,
                success=False
            )
        ]
    
    def test_detect_edge_cases(self):
        """测试检测边缘情况"""
        result = self.handler.detect_edge_cases(self.mock_traces)
        
        self.assertIsInstance(result, EdgeCaseDetectionResult)
        self.assertIsInstance(result.detected_cases, list)
        for edge_case in result.detected_cases:
            self.assertIsInstance(edge_case, EdgeCase)
    
    def test_handle_anomalies(self):
        """测试处理异常"""
        anomaly = Anomaly(
            anomaly_id="test_anomaly_1",
            anomaly_type=AnomalyType.EXECUTION_FAILURE,
            description="Timeout occurred",
            context={"action": "click", "timeout": 30},
            severity="high"
        )
        
        result = self.handler.handle_anomaly(anomaly)
        
        self.assertIsInstance(result, RecoveryResult)
        self.assertIsInstance(result.recovery_strategies, list)
        self.assertIsInstance(result.success_rate, float)
    
    def test_generate_recovery_strategies(self):
        """测试生成恢复策略"""
        edge_case = EdgeCase(
            case_id="test_case_1",
            case_name="timeout",
            description="Action timeout",
            triggers=["timeout_condition"],
            symptoms=["action_timeout"],
            impact="execution_failure",
            frequency=1,
            related_anomalies=[],
            metadata={"action": "click", "timeout": 30}
        )
        
        strategies = self.handler.generate_recovery_strategies(edge_case)
        
        self.assertIsInstance(strategies, list)
        for strategy in strategies:
            self.assertIsInstance(strategy, RecoveryStrategy)
    
    def test_learn_from_failures(self):
        """测试从失败中学习"""
        failed_traces = [
            ExecutionTrace(
                trace_id="trace1",
                task_id="task1",
                action_sequence=[],
                state_sequence=[],
                result_sequence=[],
                start_time=datetime.now(),
                end_time=datetime.now()
            )
        ]
        
        learning_results = self.handler.learn_from_failures(failed_traces)
        
        self.assertIsInstance(learning_results, list)
        for pattern in learning_results:
            self.assertIsInstance(pattern, Pattern)
    
    def test_predict_edge_cases(self):
        """测试预测边缘情况"""
        from agenticx.embodiment.core.models import ScreenState, GUIAction
        from xml.etree.ElementTree import ElementTree
        
        current_state = ScreenState(
            timestamp=time.time(),
            screen_size=(800, 600),
            orientation="portrait",
            element_tree=ElementTree(),
            app_package="com.test",
            activity_name="MainActivity"
        )
        planned_actions = []
        
        predictions = self.handler.predict_edge_cases(current_state, planned_actions)
        
        self.assertIsInstance(predictions, list)
        for prediction in predictions:
            self.assertIsInstance(prediction, EdgeCase)


class TestKnowledgeEvolution(unittest.TestCase):
    """测试知识演化管理器"""
    
    def setUp(self):
        """设置测试环境"""
        self.evolution = DefaultKnowledgeEvolution()
        
        # 创建模拟的经验
        self.mock_experiences = [
            Experience(
                experience_id="exp1",
                experience_type="task_execution",
                content={"action": "click", "element": "button1"},
                context={"app": "test", "action": "click"},
                outcome="success",
                confidence=0.9
            )
        ]
    
    def test_evolve_knowledge(self):
        """测试演化知识"""
        metrics = self.evolution.evolve_knowledge(self.mock_experiences)
        
        self.assertIsNotNone(metrics)
        self.assertIsInstance(metrics.knowledge_growth_rate, float)
        self.assertIsInstance(metrics.conflict_resolution_rate, float)
        self.assertIsInstance(metrics.validation_success_rate, float)
    
    def test_resolve_conflicts(self):
        """测试解决冲突"""
        conflicts = [
            KnowledgeConflict(
                conflict_id="conflict1",
                conflict_type=ConflictType.CONTRADICTORY,
                description="Content conflict",
                conflicting_items=["item1", "item2"],
                severity=0.7,
                context={"source": "test"}
            )
        ]
        
        resolutions = self.evolution.resolve_conflicts(conflicts)
        
        self.assertIsInstance(resolutions, list)
        for resolution in resolutions:
            self.assertIsInstance(resolution, Resolution)
    
    def test_validate_knowledge(self):
        """测试验证知识"""
        knowledge_items = [
            KnowledgeItem(
                item_id="test_item_1",
                item_type="procedural",
                content={"steps": ["step1", "step2"]},
                source="test",
                confidence=0.8,
                relevance=0.9,
                usage_count=1
            )
        ]
        
        results = self.evolution.validate_knowledge(knowledge_items, ValidationLevel.BASIC)
        
        self.assertIsInstance(results, list)
        for result in results:
            self.assertIsInstance(result, ValidationResult)
    
    def test_reflect_on_performance(self):
        """测试性能反思"""
        execution_history = [
            {
                "task_id": "task1",
                "success": True,
                "execution_time": 10.0,
                "context": {"app": "test"}
            }
        ]
        
        reflection = self.evolution.reflect_on_performance(execution_history)
        
        self.assertIsInstance(reflection, ReflectionResult)
        self.assertIsInstance(reflection.impact_assessment, dict)
        self.assertIsInstance(reflection.improvement_suggestions, list)
    
    def test_generate_efsm(self):
        """测试生成扩展有限状态机"""
        efsm = self.evolution.generate_efsm(self.mock_experiences)
        
        self.assertIsInstance(efsm, EFSM)
        self.assertIsInstance(efsm.states, list)
        self.assertIsInstance(efsm.transitions, dict)
        self.assertIsInstance(efsm.actions, dict)
    
    def test_get_knowledge_statistics(self):
        """测试获取知识统计"""
        stats = self.evolution.get_knowledge_statistics()
        
        self.assertIsInstance(stats, dict)
        self.assertIn("knowledge_items_count", stats)
        self.assertIn("experiences_count", stats)
        self.assertIn("patterns_count", stats)


class TestLearningIntegration(unittest.TestCase):
    """测试学习引擎集成"""
    
    def setUp(self):
        """设置测试环境"""
        self.retriever = DefaultAppKnowledgeRetriever()
        self.explorer = DefaultGUIExplorer()
        self.synthesizer = DefaultTaskSynthesizer()
        self.optimizer = DefaultDeepUsageOptimizer()
        self.handler = DefaultEdgeCaseHandler()
        self.evolution = DefaultKnowledgeEvolution()
    
    def test_end_to_end_learning_workflow(self):
        """测试端到端学习工作流"""
        # 1. 创建模拟数据
        # 创建测试元素
        from agenticx.embodiment.core.models import ElementTree, BoundingBox, ElementType
        
        btn_element = InteractionElement(
            element_id="btn1",
            element_type=ElementType.BUTTON,
            bounds=BoundingBox(10, 10, 90, 30),
            text="Click Me",
            clickable=True
        )
        
        element_tree = ElementTree(
            root_element=btn_element,
            elements={"btn1": btn_element}
        )
        
        screen_state = ScreenState(
            timestamp=time.time(),
            screen_size=(800, 600),
            orientation="portrait",
            element_tree=element_tree,
            screenshot_path="test.png"
        )
        
        # 2. 提取应用上下文
        app_info = {
            'name': 'Test App',
            'package': 'com.test.app',
            'version': '1.0.0',
            'category': 'Test'
        }
        app_context = self.retriever.extract_app_context(app_info)
        self.assertIsInstance(app_context, AppContext)
        
        # 3. 探索界面
        exploration_result = self.explorer.explore_interface(screen_state)
        self.assertIsInstance(exploration_result, dict)
        
        # 4. 生成动作轨迹
        mock_action = GUIAction(
            action_type=ActionType.CLICK,
            target_element_id="btn1",
            coordinates=(50, 25)
        )
        mock_action = GUIAction(action_type=ActionType.CLICK, target_element_id="test_element")
        mock_result = ActionResult(action=mock_action, success=True)
        mock_context = AppContext(
            app_package="com.test.app",
            app_name="Test App",
            app_version="1.0",
            app_category="Test",
            description="Test application"
        )
        
        trace = ActionTrace(
            trace_id="trace1",
            actions=[mock_action],
            results=[mock_result],
            states=[screen_state],
            app_context=mock_context,
            start_time=time.time(),
            success=True
        )
        
        # 5. 合成任务
        synthesis_result = self.synthesizer.synthesize_tasks_from_traces([trace])
        self.assertIsInstance(synthesis_result.synthesized_tasks, list)
        
        # 6. 创建执行日志
        log = ExecutionLog(
            log_id="log1",
            task_id="task1",
            actions=[mock_action],
            results=[mock_result],
            execution_time=1.0,
            success=True,
            performance_metrics={"avg_time": 1.0, "success_rate": 1.0}
        )
        
        # 7. 分析使用模式
        usage_analysis = self.optimizer.analyze_usage_patterns([log])
        self.assertIsInstance(usage_analysis, UsageAnalysis)
        
        # 8. 检测边缘情况
        execution_trace = ExecutionTrace(
            trace_id="trace1",
            task_id="task1",
            action_sequence=[],
            state_sequence=[],
            result_sequence=[],
            start_time=time.time(),
            end_time=time.time() + 1.0,
            success=True
        )
        edge_cases = self.handler.detect_edge_cases([execution_trace])
        self.assertIsInstance(edge_cases, list)
        
        # 9. 演化知识
        experience = Experience(
            experience_id="exp1",
            experience_type="task_execution",
            content={"action": "click", "element": "button1"},
            context={"app": "test"},
            outcome="success",
            confidence=0.9
        )
        metrics = self.evolution.evolve_knowledge([experience])
        self.assertIsNotNone(metrics)
    
    def test_component_interaction(self):
        """测试组件交互"""
        # 测试组件之间的数据流
        
        # 1. 知识检索器发现模式
        # 创建测试元素
        from agenticx.embodiment.core.models import ElementTree, BoundingBox, ElementType
        
        btn1_element = InteractionElement(
            element_id="btn1",
            element_type=ElementType.BUTTON,
            bounds=BoundingBox(10, 10, 90, 30),
            text="Button 1",
            clickable=True
        )
        
        btn2_element = InteractionElement(
            element_id="btn2",
            element_type=ElementType.BUTTON,
            bounds=BoundingBox(10, 10, 90, 30),
            text="Button 2",
            clickable=True
        )
        
        element_tree1 = ElementTree(
            root_element=btn1_element,
            elements={"btn1": btn1_element}
        )
        
        element_tree2 = ElementTree(
            root_element=btn2_element,
            elements={"btn2": btn2_element}
        )
        
        screen_states = [
            ScreenState(
                timestamp=time.time(),
                screen_size=(800, 600),
                orientation="portrait",
                element_tree=element_tree1,
                screenshot_path="test1.png"
            ),
            ScreenState(
                timestamp=time.time(),
                screen_size=(800, 600),
                orientation="portrait",
                element_tree=element_tree2,
                screenshot_path="test2.png"
            )
        ]
        
        patterns = self.retriever.discover_ui_patterns(screen_states)
        self.assertIsInstance(patterns, list)
        
        # 2. 探索器使用模式信息
        for screen_state in screen_states:
            exploration_result = self.explorer.explore_interface(screen_state)
            self.assertIsInstance(exploration_result, dict)
        
        # 3. 任务合成器创建任务
        mock_action1 = GUIAction(
            action_type=ActionType.CLICK,
            target_element_id="btn1",
            coordinates=(50, 25)
        )
        mock_action2 = GUIAction(
            action_type=ActionType.TYPE,
            target_element_id="input1",
            text_input="test input",
            coordinates=(100, 75)
        )
        mock_action1 = GUIAction(action_type=ActionType.CLICK, target_element_id="btn1")
        mock_action2 = GUIAction(action_type=ActionType.TYPE, target_element_id="input1")
        mock_result1 = ActionResult(action=mock_action1, success=True)
        mock_result2 = ActionResult(action=mock_action2, success=True)
        mock_context = AppContext(
            app_package="com.test.app",
            app_name="Test App",
            app_version="1.0",
            app_category="Test",
            description="Test application"
        )
        
        traces = [
            ActionTrace(
                trace_id="test_trace",
                actions=[mock_action1, mock_action2],
                results=[mock_result1, mock_result2],
                states=[screen_states[0], screen_states[1]],
                app_context=mock_context,
                start_time=1.0,
                end_time=3.0,
                success=True
            )
        ]
        
        synthesis_result = self.synthesizer.synthesize_tasks_from_traces(traces)
        tasks = synthesis_result.synthesized_tasks
        self.assertIsInstance(tasks, list)
        
        # 4. 优化器改进任务
        if tasks:
            workflows = self.synthesizer.generate_workflows(tasks)
            optimization_result = self.optimizer.optimize_workflows(workflows)
            self.assertIsInstance(optimization_result, OptimizationResult)
            self.assertIsInstance(optimization_result.optimized_workflows, list)


if __name__ == '__main__':
    # 运行所有测试
    unittest.main(verbosity=2)