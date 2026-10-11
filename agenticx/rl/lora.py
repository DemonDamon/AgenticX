# agenticx/rl/lora.py
"""最小 LoRA（P1 · M5）：零第三方依赖的 adapter 注入。

27B 在 8×4090 上唯一可行训练路径（FSDP 分片冻结权重 + adapter 训练）。
只做三件事: 包装 nn.Linear（冻结基座）、标准初始化（A kaiming / B 零 →
起步零增量）、adapter 参数命名与收集。不引入 peft——需要控制 FSDP 下的
参数命名，且 60 行内可完整测试。
"""
from __future__ import annotations

import math

import torch
from torch import nn

DEFAULT_TARGETS = ("q_proj", "k_proj", "v_proj", "o_proj",
                   "gate_proj", "up_proj", "down_proj")


class LoRALinear(nn.Module):
    """y = base(x) + (x @ A^T @ B^T) * (alpha/rank)；base 冻结，A/B 可训。"""

    def __init__(self, base: nn.Linear, rank: int = 16, alpha: float = 32.0):
        super().__init__()
        if rank <= 0:
            raise ValueError(f"rank 必须为正, got {rank}")
        self.base = base
        for p in self.base.parameters():
            p.requires_grad_(False)
        dt, dev = base.weight.dtype, base.weight.device
        self.lora_A = nn.Parameter(torch.empty(rank, base.in_features,
                                               dtype=dt, device=dev))
        self.lora_B = nn.Parameter(torch.zeros(base.out_features, rank,
                                               dtype=dt, device=dev))
        nn.init.kaiming_uniform_(self.lora_A, a=math.sqrt(5))
        self.scaling = alpha / rank

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.base(x) + (x @ self.lora_A.T @ self.lora_B.T) * self.scaling


def inject_lora(model: nn.Module, *, rank: int = 16, alpha: float = 32.0,
                target_patterns: tuple[str, ...] = DEFAULT_TARGETS) -> int:
    """把名字以任一 pattern 结尾的 nn.Linear 替换为 LoRALinear，返回替换数。"""
    count = 0
    for name, mod in list(model.named_modules()):
        if isinstance(mod, nn.Linear) and name.endswith(target_patterns):
            _replace_child(model, name, LoRALinear(mod, rank=rank, alpha=alpha))
            count += 1
    return count


def _replace_child(root: nn.Module, dotted: str, new: nn.Module) -> None:
    parent = root
    parts = dotted.split(".")
    for p in parts[:-1]:
        parent = parent.get_submodule(p)
    setattr(parent, parts[-1], new)


def mark_only_lora_trainable(model: nn.Module) -> int:
    for p in model.parameters():
        p.requires_grad_(False)
    n = 0
    for name, p in model.named_parameters():
        if "lora_" in name:
            p.requires_grad_(True)
            n += 1
    return n


def trainable_parameters(model: nn.Module) -> list[nn.Parameter]:
    return [p for p in model.parameters() if p.requires_grad]


def lora_state_dict(model: nn.Module) -> dict[str, torch.Tensor]:
    return {k: v.detach().cpu() for k, v in model.state_dict().items()
            if "lora_" in k}


def load_lora_state_dict(model: nn.Module, sd: dict[str, torch.Tensor]) -> None:
    cur = lora_state_dict(model)
    if set(sd) != set(cur):
        raise KeyError(f"adapter 键不匹配: 缺 {sorted(set(cur) - set(sd))}, "
                       f"多 {sorted(set(sd) - set(cur))}")
    with torch.no_grad():
        for k, v in sd.items():
            tgt = model.get_parameter(k)
            tgt.copy_(v.to(tgt.device))
