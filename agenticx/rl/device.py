# agenticx/rl/device.py
"""设备注册表（P1 · M1）：多硬件后端探测 + dtype 策略 + autocast 助手。

后端优先级: cuda(含 ROCm-as-cuda) > npu(昇腾) > mps(Apple) > cpu。
真机启用方式:
  - NVIDIA/AMD: 官方或 ROCm 版 torch，检测自动生效
  - 昇腾: pip install torch_npu + CANN toolkit（ASCEND_TOOLKIT_HOME），
    import torch_npu 会为 torch 打补丁挂上 torch.npu
  - Apple: pytorch>=2.0 自带 MPS
"""
from __future__ import annotations

from dataclasses import dataclass

import torch


@dataclass(frozen=True)
class DeviceInfo:
    kind: str           # "cuda" | "npu" | "mps" | "cpu"
    name: str           # 人读名（ROCm 会打标签）
    dtype: torch.dtype  # 推荐训练 dtype
    bf16: bool          # 是否支持 bf16

    @property
    def torch_device(self) -> torch.device:
        return torch.device(self.kind)


def _probe_cuda() -> DeviceInfo | None:
    if not torch.cuda.is_available():
        return None
    idx = torch.cuda.current_device()
    name = torch.cuda.get_device_name(idx)
    hip = getattr(torch.version, "hip", None)
    label = f"{name} [ROCm]" if hip else name
    bf16 = bool(torch.cuda.is_bf16_supported())
    dtype = torch.bfloat16 if bf16 else torch.float16
    return DeviceInfo("cuda", label, dtype, bf16)


def _probe_npu() -> DeviceInfo | None:
    try:
        import torch_npu  # noqa: F401  守卫式：未安装则静默跳过
    except Exception:
        return None
    npu = getattr(torch, "npu", None)
    if npu is None or not npu.is_available():
        return None
    try:
        name = npu.get_device_name(0)
    except Exception:
        name = "Ascend NPU"
    return DeviceInfo("npu", name, torch.bfloat16, True)


def _probe_mps() -> DeviceInfo | None:
    mps = getattr(torch.backends, "mps", None)
    if mps is None or not mps.is_available():
        return None
    return DeviceInfo("mps", "Apple Silicon (MPS)", torch.float32, False)


_OVERRIDES: dict[str, DeviceInfo] = {
    "cpu": DeviceInfo("cpu", "CPU", torch.float32, False),
    "cuda": DeviceInfo("cuda", "CUDA (forced)", torch.bfloat16, True),
    "npu": DeviceInfo("npu", "NPU (forced)", torch.bfloat16, True),
    "mps": DeviceInfo("mps", "MPS (forced)", torch.float32, False),
}


def detect_device(override: str | None = None) -> DeviceInfo:
    """探测可用训练设备；override 强制指定（"cpu"/"cuda"/"npu"/"mps"，CI 用）。"""
    if override is not None:
        if override not in _OVERRIDES:
            raise ValueError(f"未知设备类型 {override!r}，可选 {sorted(_OVERRIDES)}")
        return _OVERRIDES[override]
    for probe in (_probe_cuda, _probe_npu, _probe_mps):
        info = probe()
        if info is not None:
            return info
    return _OVERRIDES["cpu"]


def autocast_for(info: DeviceInfo, *, enabled: bool = True):
    """混合精度上下文：cuda/npu 用 autocast；mps/cpu 保守关闭（纯 fp32）。

    mps 的 fp16 属可选手动路径（教程级 matmul OK），训练核默认 fp32 求稳。
    """
    if info.kind == "cuda":
        return torch.autocast(device_type="cuda", dtype=info.dtype, enabled=enabled)
    if info.kind == "npu":
        return torch.autocast(device_type="npu", dtype=torch.bfloat16, enabled=enabled)
    return torch.autocast(device_type="cpu", enabled=False)
