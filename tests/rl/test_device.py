# tests/rl/test_device.py
import pytest
import torch

from agenticx.rl.device import DeviceInfo, autocast_for, detect_device


def _mock_cuda(monkeypatch, *, bf16=True, name="NVIDIA A100", hip=None):
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    monkeypatch.setattr(torch.cuda, "current_device", lambda: 0)
    monkeypatch.setattr(torch.cuda, "get_device_name", lambda i: name)
    monkeypatch.setattr(torch.cuda, "is_bf16_supported", lambda: bf16)
    monkeypatch.setattr(torch.version, "hip", hip)


def test_detect_cpu_override():
    info = detect_device("cpu")
    assert info.kind == "cpu"
    assert info.dtype == torch.float32
    assert info.torch_device == torch.device("cpu")


def test_detect_override_table_covers_all_backends():
    assert detect_device("cuda").dtype == torch.bfloat16
    assert detect_device("npu").dtype == torch.bfloat16
    assert detect_device("mps").dtype == torch.float32


def test_detect_unknown_override_raises():
    with pytest.raises(ValueError):
        detect_device("tpu")


def test_detect_default_returns_valid_kind():
    # 本机真实探测：无 GPU 环境应落 mps 或 cpu
    info = detect_device()
    assert info.kind in ("cpu", "mps", "cuda", "npu")


def test_cuda_probe_prefers_bf16(monkeypatch):
    _mock_cuda(monkeypatch, bf16=True)
    info = detect_device()
    assert info.kind == "cuda" and info.bf16
    assert info.dtype == torch.bfloat16
    assert "A100" in info.name


def test_cuda_probe_fp16_fallback(monkeypatch):
    _mock_cuda(monkeypatch, bf16=False)
    info = detect_device()
    assert info.kind == "cuda" and not info.bf16
    assert info.dtype == torch.float16


def test_rocm_labelled_in_name(monkeypatch):
    _mock_cuda(monkeypatch, name="AMD Instinct MI300X", hip="6.2.4")
    info = detect_device()
    assert info.kind == "cuda"
    assert "ROCm" in info.name


def test_cuda_priority_over_mps(monkeypatch):
    # 本机 mps 真实可用，mock cuda 后应选 cuda
    _mock_cuda(monkeypatch)
    assert detect_device().kind == "cuda"


def test_npu_not_detected_without_torch_npu():
    # CI/本机未装 torch_npu：探测结果绝不能是 npu（守卫式导入不炸）
    assert detect_device().kind != "npu"


def test_autocast_cpu_is_noop():
    info = detect_device("cpu")
    with autocast_for(info):
        x = torch.ones(3)
    assert x.dtype == torch.float32


def test_autocast_cuda_disabled_constructs():
    # enabled=False 时无真 cuda 也不应炸
    info = detect_device("cuda")
    with autocast_for(info, enabled=False):
        pass


def test_device_info_is_frozen():
    info = detect_device("cpu")
    with pytest.raises(Exception):
        info.kind = "cuda"
