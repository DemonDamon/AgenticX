# ADR-001: 安全沙箱系统设计

## 状态

已实施

## 上下文

AgenticX 需要一个安全的代码执行环境，以支持 Agent 执行不可信代码。现有的 `CodeActionExecutor` 仅提供线程级隔离，无法满足安全需求。

### 需求

1. 支持安全执行用户提供的 Python 代码
2. 支持多种隔离级别（开发、测试、生产）
3. 资源限制（CPU、内存、磁盘）
4. 超时控制
5. 与现有工具系统集成

### 研究来源

- AgentRun-SDK-Python: 阿里云 AgentRun 的 Python SDK
- Microsandbox: 基于 libkrun 的轻量级虚拟机沙箱

## 决策

采用多后端沙箱架构，提供三种隔离级别：

### 架构

```
CodeInterpreterSandbox (高级 API)
         │
    Sandbox Factory (后端选择)
         │
    ┌────┼────┐
    │    │    │
Subprocess  Microsandbox  Docker
(开发)      (推荐)        (降级)
```

### 后端选择策略

1. **subprocess**: 基于 `asyncio.create_subprocess_exec`，仅进程级隔离
   - 优点: 零依赖、快速启动
   - 缺点: 隔离级别低
   - 场景: 开发和测试环境

2. **microsandbox**: 基于 libkrun 的硬件级隔离
   - 优点: 真正的虚拟机隔离、安全性高
   - 缺点: 需要额外依赖、需要 KVM 支持
   - 场景: 生产环境推荐

3. **docker**: 容器级隔离
   - 优点: 广泛部署、成熟稳定
   - 缺点: 需要 Docker 守护进程
   - 场景: microsandbox 不可用时的降级方案

### 关键设计

1. **统一接口**: 所有后端实现 `SandboxBase` 抽象基类
2. **上下文管理器**: 自动资源清理
3. **配置模板**: 预定义和自定义资源配置
4. **健康检查**: 内置健康检查机制

## 后果

### 正面

- 灵活的隔离级别选择
- 与现有代码的低耦合
- 易于扩展新后端
- 生产级安全保障

### 负面

- 增加了系统复杂度
- 部分后端需要额外依赖
- microsandbox 仅支持 Linux/macOS

### 风险

- Microsandbox 兼容性问题 → 提供 Docker 降级方案
- 性能开销 → 实现沙箱池化和预热

## 实施

- Phase 1: 基础架构 + subprocess 后端 ✅
- Phase 2: microsandbox 后端 + ToolExecutor 集成 ✅
- Phase 3: Docker 后端（如需）

## 参考

- [AgentRun-SDK-Python](https://github.com/Serverless-Devs/agentrun-sdk-python)
- [Microsandbox](https://github.com/ArcadeLabsInc/microsandbox)
- [研究文档](../research/codedeepresearch/agentrun-sdk-python/)
