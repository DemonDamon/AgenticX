import pytest
from agenticx.safety.sandbox_policy import (
    SandboxPolicy,
    SandboxRecommendation,
    ToolRiskProfile,
    RiskLevel,
)


def test_high_risk_tool_gets_docker():
    policy = SandboxPolicy()
    rec = policy.recommend("shell_tool", risk_level=RiskLevel.HIGH)
    assert rec.backend == "docker"
    assert rec.network_enabled is False


def test_medium_risk_tool_gets_subprocess():
    policy = SandboxPolicy()
    rec = policy.recommend("file_reader", risk_level=RiskLevel.MEDIUM)
    assert rec.backend == "subprocess"


def test_low_risk_tool_gets_none():
    policy = SandboxPolicy()
    rec = policy.recommend("calculator", risk_level=RiskLevel.LOW)
    assert rec.backend is None


def test_custom_profile_overrides():
    profile = ToolRiskProfile(
        tool_name="my_tool",
        risk_level=RiskLevel.CRITICAL,
        force_backend="docker",
        network_enabled=False,
        max_timeout=30,
    )
    policy = SandboxPolicy(tool_profiles=[profile])
    rec = policy.recommend("my_tool")
    assert rec.backend == "docker"
    assert rec.max_timeout == 30


def test_infer_risk_from_tool_name():
    policy = SandboxPolicy()
    rec = policy.recommend("bash_executor")
    assert rec.backend in ("docker", "subprocess")


def test_infer_risk_low_for_unknown():
    policy = SandboxPolicy()
    rec = policy.recommend("calculator")
    assert rec.backend is None


def test_critical_risk_has_short_timeout():
    policy = SandboxPolicy()
    rec = policy.recommend("exec_tool", risk_level=RiskLevel.CRITICAL)
    assert rec.max_timeout <= 60
