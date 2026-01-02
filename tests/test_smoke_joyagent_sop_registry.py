import pytest
import asyncio

from agenticx.memory.sop_registry import SOPRegistry, SOPItem
from agenticx.agents.mining_planner_agent import MiningPlannerAgent
from agenticx.core.agent import AgentContext


class _FakeLLM:
    def __init__(self):
        self.last_prompt = None

    def invoke(self, messages):
        # messages: list of {"role":..., "content":...}
        if messages:
            self.last_prompt = messages[-1]["content"]
        # 返回最小可解析的 MiningPlan JSON
        return """{
          "goal": "test",
          "steps": [
            {"step_type": "search", "title": "s", "description": "d", "need_external_info": true}
          ],
          "exploration_strategy": "breadth_first",
          "stop_condition": "max_steps",
          "max_total_cost": 1.0
        }"""


def test_sop_registry_modes():
    reg = SOPRegistry(high_threshold=0.6, low_threshold=0.2, max_recall=3)
    reg.add_sop(
        SOPItem(
            name="销售数据分析",
            description="对销售额利润进行综合分析",
            steps=["统计销售额", "分析利润", "生成报告"],
        )
    )
    reg.add_sop(
        SOPItem(
            name="旅游规划",
            description="制定旅游行程",
            steps=["机票预定", "酒店预定"],
        )
    )

    mode_high, prompt_high = reg.build_prompt("销售额利润分析")
    assert mode_high == "HIGH_MODE"
    assert "销售数据分析" in prompt_high

    mode_no, prompt_no = reg.build_prompt("完全无关的主题")
    assert mode_no == "NO_SOP_MODE"
    assert "未找到可参考的 SOP" in prompt_no


def test_planner_injects_sop_prompt():
    reg = SOPRegistry(high_threshold=0.5, low_threshold=0.2)
    reg.add_sop(
        SOPItem(
            name="代码审查",
            description="执行静态检查",
            steps=["运行单测", "检查覆盖率"],
        )
    )
    llm = _FakeLLM()
    planner = MiningPlannerAgent(llm_provider=llm, sop_registry=reg, auto_accept=True)
    asyncio.run(planner.plan(goal="请进行代码检查", context=AgentContext(agent_id="test")))
    assert llm.last_prompt is not None
    assert "SOP" in llm.last_prompt
    assert "代码审查" in llm.last_prompt


def test_sop_registry_dedup():
    """测试去重功能"""
    reg = SOPRegistry()
    sop1 = SOPItem(name="测试SOP", description="desc1", steps=["step1"])
    sop2 = SOPItem(name="测试SOP", description="desc2", steps=["step2"])
    
    # 第一次添加成功
    assert reg.add_sop(sop1) is True
    assert len(reg.list_sops()) == 1
    
    # 重复添加失败（默认不覆盖）
    assert reg.add_sop(sop2) is False
    assert len(reg.list_sops()) == 1
    assert reg.get_sop("测试SOP").description == "desc1"
    
    # 覆盖模式添加成功
    assert reg.add_sop(sop2, overwrite=True) is True
    assert len(reg.list_sops()) == 1
    assert reg.get_sop("测试SOP").description == "desc2"


def test_sop_registry_cache():
    """测试缓存功能"""
    reg = SOPRegistry(cache_size=2)
    reg.add_sop(SOPItem(name="SOP_A", description="关于A的操作", steps=["执行A"]))
    reg.add_sop(SOPItem(name="SOP_B", description="关于B的操作", steps=["执行B"]))
    
    # 初始缓存为空
    assert reg.cache_stats["size"] == 0
    
    # 第一次查询，写入缓存
    _ = reg.recall("关于A")
    assert reg.cache_stats["size"] == 1
    
    # 相同查询命中缓存
    _ = reg.recall("关于A")
    assert reg.cache_stats["size"] == 1
    
    # 不同查询增加缓存
    _ = reg.recall("关于B")
    assert reg.cache_stats["size"] == 2
    
    # 超过缓存大小，LRU 淘汰
    _ = reg.recall("关于C")
    assert reg.cache_stats["size"] == 2  # 仍为 2（LRU 淘汰了最早的）
    
    # 禁用缓存不写入
    _ = reg.recall("关于D", use_cache=False)
    assert reg.cache_stats["size"] == 2

