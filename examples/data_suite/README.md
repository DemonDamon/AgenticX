# Data Suite examples

| Directory | Role |
|-----------|------|
| [golden_path/](golden_path/) | A-layer end-to-end spine (FakeChannel → … → patrol). One command in its README. |
| [delivery_pack/](delivery_pack/) | Desensitized B-layer config skeleton (B1–B6). Apply with `apply.py`; copy to a **separate** customer repo for real projects. |

Platform APIs live under `agenticx/data_suite/` (including `pack.load_pack` / `pack.register_pack`). Do not put real customer names or secrets in this tree.
