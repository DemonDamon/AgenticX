# infra

TeamBench 评测基础设施（自包含，OpenAI 兼容接口直连，不依赖特定 Agent 框架）。

- 团队级评测 runner（含 4 档装配协议：last / concat / integrator / blackboard）
- artifact 核验器（L1 结构 / L2 数值断言 / L3 LLM-judge）
- 轨迹与中间产物落盘（role_outputs 全量保存）
- 基线框架适配层（lightweight / LangGraph / AutoGen 等对外统一接口）
- 个体对照模式执行器（single / refine-k / best-of-k 算力对齐基线）
