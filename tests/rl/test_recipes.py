# tests/rl/test_recipes.py
from agenticx.rl.recipes import (
    HARDWARE, QWEN_MODEL_PARAMS, memory_feasibility, recommend,
)


def test_full_ft_memory_math():
    # 8B 全参 + KL ref: (16+2)*8e9/8 = 18 GB/卡 < 24*0.85=20.4
    f = memory_feasibility(8e9, "full", 8, 24)
    assert f.per_gpu_gb == 18.0 and f.feasible


def test_27b_full_infeasible_on_4090_feasible_on_a100():
    f = memory_feasibility(27e9, "full", 8, 24)
    assert not f.feasible and f.per_gpu_gb == 60.75
    assert memory_feasibility(27e9, "full", 8, 80).feasible   # 60.75 < 68


def test_27b_lora_feasible_on_8x4090():
    # (2+2)*27e9/8 = 13.5 < 20.4 —— 修正旧表: FSDP 分片下 27B LoRA 在 4090 可行
    f = memory_feasibility(27e9, "lora", 8, 24)
    assert f.feasible and f.per_gpu_gb == 13.5


def test_27b_lora_single_card_infeasible():
    assert not memory_feasibility(27e9, "lora", 1, 24).feasible  # 54 > 20.4


def test_recommend_falls_back_to_lora():
    r = recommend(27e9, 8, 24)
    assert r.method == "lora" and r.feasible and r.lora_rank == 16
    assert recommend(8e9, 8, 24).method == "full"
    assert recommend(27e9, 1, 24).method == "infeasible"


def test_no_kl_ref_reduces_memory():
    assert memory_feasibility(27e9, "lora", 8, 24, kl_ref=False).per_gpu_gb == 6.75


def test_catalog_present():
    assert QWEN_MODEL_PARAMS["qwen3.8-27b"] == 27e9
    assert HARDWARE["8x4090"] == (8, 24)
