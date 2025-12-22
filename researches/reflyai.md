# Refly.AI 核心技术架构深度分析

基于对 Refly 开源项目源码的深入研究，本文档提炼出 10 个核心技术问题及其实现细节。

## 项目概览

Refly.AI 是全球首个 **Vibe Workflow Platform**（氛围工作流平台），专为非技术创作者设计，通过可视化 Canvas 和智能编排实现 AI 自动化工作流。

**技术栈:**
- **架构:** Monorepo (Turborepo)
- **前端:** React + TypeScript + Tailwind CSS + @xyflow/react (可视化流程图)
- **后端:** NestJS + Prisma + PostgreSQL
- **消息队列:** BullMQ + Redis
- **AI框架:** LangChain + LangGraph
- **向量存储:** 支持多种向量数据库
- **浏览器扩展:** WXT框架

---

## 核心技术问题深度解析

### 1. 整体技术架构设计：如何实现前后端协同的工作流引擎？

#### 架构层次划分

**1.1 包结构设计 (Monorepo)**

```
refly/
├── apps/
│   ├── api/              # NestJS 后端服务 (核心引擎)
│   ├── web/              # React 前端应用 (Canvas编辑器)
│   └── extension/        # 浏览器扩展 (内容抓取)
├── packages/
│   ├── canvas-common/    # 工作流编排核心逻辑
│   ├── skill-template/   # Skill引擎 (LangChain集成)
│   ├── agent-tools/      # 工具系统抽象层
│   ├── sandbox-agent/    # 代码执行沙箱
│   ├── common-types/     # 跨包类型定义
│   └── openapi-schema/   # API Schema定义
```

**关键设计理念:**
- **前后端共享核心逻辑:** `canvas-common` 包同时被前端和后端依赖，确保工作流编排逻辑的一致性
- **循环依赖避免:** 通过 `common-types` 包定义接口，打破 `agent-tools` 和 `skill-template` 之间的循环依赖

**1.2 工作流执行的三层架构**

```typescript
// 层级1: Canvas层 - 前端可视化编排
CanvasData {
  nodes: CanvasNode[]    // 节点定义
  edges: CanvasEdge[]    // 连接关系
  variables: WorkflowVariable[]  // 工作流变量
}

// 层级2: Workflow层 - 后端调度引擎
WorkflowExecution {
  executionId: string
  status: 'executing' | 'finish' | 'failed'
  nodeExecutions: WorkflowNodeExecution[]
}

// 层级3: Skill层 - AI能力执行单元
SkillEngine {
  chatModel()           // LLM模型实例化
  invoke(request)       // 技能调用
}
```

**核心源码位置:**
- 前端编排逻辑: `packages/canvas-common/src/workflow.ts`
- 后端调度引擎: `apps/api/src/modules/workflow/workflow.service.ts`
- 技能引擎: `packages/skill-template/src/base.ts`

---

### 2. 智能体编排机制：如何实现可视化节点到Agent执行的映射？

#### 2.1 节点类型体系

Refly 定义了多种节点类型，每种节点对应不同的执行策略:

```typescript
type CanvasNodeType = 
  | 'skillResponse'     // AI技能节点 (核心智能体)
  | 'document'          // 文档节点
  | 'codeArtifact'      // 代码制品节点
  | 'resource'          // 资源节点
  | 'image' | 'video' | 'audio'  // 媒体节点
  | 'website'           // 网站节点
```

**关键实现 - 节点执行器:**

```typescript:1:163:packages/canvas-common/src/node-executor.ts
// 简化版节点执行器
export class NodeExecutor {
  async executeNode(node: WorkflowNode): Promise<void> {
    switch (node.type) {
      case 'skill':
        await this.executeSkillNode(node);  // 调用LLM
        break;
      default:
        await this.executeGenericNode(node); // 通用处理
    }
  }

  private async executeSkillNode(node: WorkflowNode): Promise<void> {
    // 构建技能调用请求
    const skillRequest: InvokeSkillRequest = {
      input: { query: node.title },
      context: this.buildSkillContext(node),
      skillName: 'commonQnA',
      resultId: node.entityId
    };
    // 模拟进度更新
    for (let step = 1; step <= totalSteps; step++) {
      node.progress = (step / totalSteps) * 100;
      // ... 实际LLM调用
    }
  }
}
```

#### 2.2 节点编排算法 - 拓扑排序

**核心问题:** 如何确保父节点在子节点之前执行？

**解决方案:** 使用拓扑排序 (Topological Sort) 维护执行顺序

```typescript:304:351:packages/canvas-common/src/workflow.ts
export const sortNodeExecutionsByExecutionOrder = <T extends WorkflowNodeExecution>(
  nodeExecutions: T[],
): T[] => {
  const nodeMap = new Map(nodeExecutions.map((n) => [n.nodeId, n]));
  const visited = new Set<string>();
  const result: T[] = [];

  const visit = (nodeExecution: T) => {
    if (visited.has(nodeExecution.nodeId)) return;
    visited.add(nodeExecution.nodeId);

    // 先访问所有父节点
    const parentNodeIds = JSON.parse(nodeExecution.parentNodeIds || '[]') as string[];
    const parentNodes = parentNodeIds
      .map((parentId) => nodeMap.get(parentId))
      .filter((node): node is T => node !== undefined)
      .sort((a, b) => a.nodeId.localeCompare(b.nodeId));

    for (const parentNode of parentNodes) {
      visit(parentNode);
    }

    result.push(nodeExecution);
  };

  // 按原始顺序访问所有节点
  const sortedNodeExecutions = [...nodeExecutions].sort((a, b) => 
    a.nodeId.localeCompare(b.nodeId)
  );

  for (const nodeExecution of sortedNodeExecutions) {
    visit(nodeExecution);
  }

  return result;
};
```

**关键设计点:**
1. **DFS遍历:** 深度优先搜索确保依赖链完整
2. **去重机制:** `visited` Set 避免重复访问
3. **顺序保证:** 同级节点按 nodeId 排序，保持确定性

---

### 3. 多智能体协作：如何实现节点间的上下文传递和依赖管理？

#### 3.1 上下文传递机制

**核心数据结构:**

```typescript:1:11:packages/canvas-common/src/context.ts
export const convertResultContextToItems = (
  context: SkillContext,
  history: ActionResult[],
): IContextItem[] => {
  const items: IContextItem[] = [];
  
  // 历史结果转换
  for (const item of history ?? []) {
    items.push({
      type: 'skillResponse',
      entityId: item.resultId,
    });
  }
  
  // 内容列表转换
  for (const content of context?.contentList ?? []) {
    const metadata = content.metadata as any;
    items.push({
      type: metadata?.domain?.includes('resource') ? 'resource' : 'skillResponse',
      entityId: metadata?.entityId ?? '',
      title: metadata?.title ?? 'Selected Content',
      metadata: {
        contentPreview: content.content,
        selectedContent: content.content,
        // ...
      },
    });
  }
}
```

#### 3.2 依赖关系构建

**父子关系映射:**

```typescript:97:128:packages/canvas-common/src/workflow.ts
const buildNodeRelationships = (nodes: CanvasNode[], edges: CanvasEdge[]) => {
  const nodeMap = new Map<string, CanvasNode>();
  const parentMap = new Map<string, string[]>();
  const childMap = new Map<string, string[]>();

  // 初始化映射
  for (const node of nodes) {
    nodeMap.set(node.id, node);
    parentMap.set(node.id, []);
    childMap.set(node.id, []);
  }

  // 根据边构建关系
  for (const edge of edges || []) {
    const sourceId = edge.source;
    const targetId = edge.target;

    if (nodeMap.has(sourceId) && nodeMap.has(targetId)) {
      // 将target添加为source的子节点
      const sourceChildren = childMap.get(sourceId) || [];
      sourceChildren.push(targetId);
      childMap.set(sourceId, sourceChildren);

      // 将source添加为target的父节点
      const targetParents = parentMap.get(targetId) || [];
      targetParents.push(sourceId);
      parentMap.set(targetId, targetParents);
    }
  }

  return { nodeMap, parentMap, childMap };
};
```

#### 3.3 上下文增强 - 变量解析

**工作流变量与上下文项的融合:**

```typescript:46:77:packages/canvas-common/src/workflow.ts
export const updateContextItemsFromVariables = (
  contextItems: IContextItem[],
  variables: WorkflowVariable[],
): IContextItem[] => {
  const enhancedContextItems = [...contextItems];

  // 遍历资源类型变量
  for (const variable of variables) {
    if (variable.variableType === 'resource') {
      for (const value of variable.value) {
        if (value.type === 'resource' && value.resource?.entityId) {
          // 检查资源是否已存在于上下文
          const existingItemIndex = enhancedContextItems.findIndex(
            (item) => item.entityId === value.resource?.entityId && item.type === 'resource',
          );

          if (existingItemIndex >= 0) {
            // 更新已有上下文项的标题为变量名
            enhancedContextItems[existingItemIndex].title = value.resource.name;
          }
        }
      }
    }
  }

  return enhancedContextItems;
};
```

**关键机制:**
1. **资源变量解析:** 将工作流级别的资源变量注入到节点上下文
2. **去重合并:** 避免同一资源被重复引用
3. **标题覆盖:** 使用变量名作为资源显示名称

---

### 4. 工作流执行引擎：如何实现分布式任务调度和并发控制？

#### 4.1 任务队列设计

Refly 使用 **BullMQ** 实现分布式任务调度:

```typescript:33:66:apps/api/src/modules/workflow/workflow.service.ts
@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @InjectQueue(QUEUE_RUN_WORKFLOW) 
    private readonly runWorkflowQueue?: Queue<RunWorkflowJobData>,
    @InjectQueue(QUEUE_POLL_WORKFLOW)
    private readonly pollWorkflowQueue?: Queue<PollWorkflowJobData>,
  ) {}
}
```

**两个核心队列:**

1. **RunWorkflow队列:** 执行单个节点
2. **PollWorkflow队列:** 轮询工作流状态，触发下一批节点

#### 4.2 节点执行流程

```typescript:399:521:apps/api/src/modules/workflow/workflow.service.ts
async runWorkflow(data: RunWorkflowJobData): Promise<void> {
  const { user, executionId, nodeId } = data;

  // 1. 获取分布式锁 (防止多个Worker重复执行)
  const lockKey = `workflow:node:${executionId}:${nodeId}`;
  const releaseLock = await this.redis.acquireLock(lockKey);
  if (!releaseLock) {
    return;  // 锁获取失败，跳过执行
  }

  try {
    // 2. 查询节点执行记录
    const nodeExecution = await this.prisma.workflowNodeExecution.findFirst({
      where: { executionId, nodeId },
    });

    // 3. 验证父节点是否全部完成
    const parentNodeIds = safeParseJSON(nodeExecution.parentNodeIds) ?? [];
    const allParentsFinishedCount = await this.prisma.workflowNodeExecution.count({
      where: {
        executionId: nodeExecution.executionId,
        nodeId: { in: parentNodeIds as string[] },
        status: 'finish',
      },
    });
    const allParentsFinished = allParentsFinishedCount === (parentNodeIds?.length ?? 0);

    if (!allParentsFinished) {
      return;  // 父节点未完成，跳过
    }

    // 4. 原子性状态更新 (防止并发竞争)
    const updateRes = await this.prisma.workflowNodeExecution.updateMany({
      where: {
        nodeExecutionId: nodeExecution.nodeExecutionId,
        status: { in: ['init', 'waiting'] },
      },
      data: { status: 'executing', startTime: new Date(), progress: 0 },
    });

    if ((updateRes?.count ?? 0) === 0) {
      return;  // 其他Worker抢先执行了
    }

    // 5. 执行节点
    if (nodeExecution.nodeType === 'skillResponse') {
      await this.executeSkillResponseNode(user, nodeExecution);
    } else {
      await this.prisma.workflowNodeExecution.update({
        where: { nodeExecutionId: nodeExecution.nodeExecutionId },
        data: { status: 'finish', progress: 100, endTime: new Date() },
      });
    }
  } finally {
    await releaseLock?.();  // 释放锁
  }
}
```

**并发控制关键技术:**

1. **分布式锁:** Redis实现的锁机制，确保同一节点不被多次执行
2. **乐观锁:** 使用 `updateMany` + 状态条件，防止状态竞争
3. **幂等性设计:** 重复执行同一任务不会产生副作用

#### 4.3 轮询调度器 (Poll机制)

```typescript:526:835:apps/api/src/modules/workflow/workflow.service.ts
async pollWorkflow(data: PollWorkflowJobData): Promise<void> {
  const { user, executionId, nodeBehavior } = data;

  // 1. 获取轮询锁
  const lockKey = `workflow:poll:${executionId}`;
  const releaseLock = await this.redis.acquireLock(lockKey, POLL_LOCK_TTL_MS);
  if (!releaseLock) return;

  try {
    // 2. 检查工作流状态和超时
    const workflowExecution = await this.prisma.workflowExecution.findUnique({
      where: { executionId },
    });

    if (workflowExecution.status === 'failed' || workflowExecution.status === 'finish') {
      return;  // 已完成，停止轮询
    }

    // 3. 超时处理
    const executionAge = Date.now() - workflowExecution.createdAt.getTime();
    if (executionAge > WORKFLOW_EXECUTION_TIMEOUT_MS) {
      await this.prisma.workflowNodeExecution.updateMany({
        where: { executionId, status: { notIn: ['finish', 'failed'] } },
        data: { status: 'failed', errorMessage: 'Workflow timeout' },
      });
      await this.prisma.workflowExecution.update({
        where: { executionId },
        data: { status: 'failed' },
      });
      return;
    }

    // 4. 加载所有节点
    const allNodes = await this.prisma.workflowNodeExecution.findMany({
      where: { executionId },
    });

    // 5. 查找就绪的waiting节点
    const waitingSkillNodes = allNodes.filter(
      (n) => (n.status === 'init' || n.status === 'waiting') && n.nodeType === 'skillResponse',
    );

    for (const n of waitingSkillNodes) {
      const parents = (safeParseJSON(n.parentNodeIds) ?? []) as string[];
      const allParentsFinished = parents.every((p) => 
        statusByNodeId.get(p) === 'finish'
      );

      if (allParentsFinished && this.runWorkflowQueue) {
        // 6. 将就绪节点加入执行队列
        await this.runWorkflowQueue.add('runWorkflow', {
          user: { uid: user.uid },
          executionId,
          nodeId: n.nodeId,
          nodeBehavior,
        });
      }
    }

    // 7. 计算执行统计
    const executedNodes = allNodes.filter(n => n.status === 'finish').length;
    const failedNodes = allNodes.filter(n => n.status === 'failed').length;
    const pendingNodes = allNodes.filter(n => 
      n.status === 'init' || n.status === 'waiting'
    ).length;
    const executingNodes = allNodes.filter(n => n.status === 'executing').length;

    // 8. 更新工作流状态
    let newStatus = 'executing';
    if (failedNodes > 0) {
      newStatus = 'failed';
    } else if (pendingNodes === 0 && executingNodes === 0) {
      newStatus = 'finish';
    }

    await this.prisma.workflowExecution.update({
      where: { executionId },
      data: { executedNodes, failedNodes, status: newStatus },
    });

    // 9. 决定是否继续轮询
    const hasPendingOrExecuting = pendingNodes > 0 || executingNodes > 0;
    if (hasPendingOrExecuting && newStatus === 'executing' && this.pollWorkflowQueue) {
      await this.pollWorkflowQueue.add(
        'pollWorkflow',
        { user, executionId, nodeBehavior },
        { delay: WORKFLOW_POLL_INTERVAL, removeOnComplete: true },
      );
    }
  } finally {
    await releaseLock?.();
  }
}
```

**轮询机制优势:**
- **自适应调度:** 根据节点状态动态触发下一批任务
- **故障隔离:** 单个节点失败不影响整体工作流
- **自动恢复:** 超时节点会被标记为失败，不阻塞后续执行

---

### 5. 上下文管理：如何处理大规模上下文和跨节点状态共享？

#### 5.1 上下文转换管道

Refly 实现了多层上下文转换机制:

```typescript:157:230:packages/canvas-common/src/context.ts
export const convertContextItemsToInvokeParams = (
  items: IContextItem[],
  resultIds: string[],
  workflowVariables?: WorkflowVariable[],
): SkillContext => {
  const purgedItems = purgeContextItems(items);

  // 1. 构建变量ID到文件ID的映射
  const variableToFileIdMap = new Map<string, {
    fileId: string;
    variableId: string;
    variableName: string;
  }>();

  // 2. 收集资源变量中的文件
  const filesFromVariables: SkillContextFileItem[] = [];
  if (workflowVariables) {
    for (const variable of workflowVariables) {
      if (variable.variableType === 'resource' && variable.value?.length > 0) {
        const fileId = variable.value[0]?.resource?.fileId;
        if (fileId) {
          variableToFileIdMap.set(variable.variableId, {
            fileId,
            variableId: variable.variableId,
            variableName: variable.name,
          });
          filesFromVariables.push({
            fileId,
            variableId: variable.variableId,
            variableName: variable.name,
          });
        }
      }
    }
  }

  // 3. 从上下文项中获取文件
  const filesFromContextItems = purgedItems
    ?.filter((item) => item?.type === 'file')
    .map((item) => {
      // 解析资源变量
      if (item.metadata?.source === 'variable' && item.metadata?.variableId) {
        const detail = variableToFileIdMap.get(item.metadata.variableId);
        if (detail) return detail;
      }
      // 直接文件引用
      return { fileId: item.entityId };
    })
    .filter((item): item is SkillContextFileItem => item !== null);

  // 4. 合并文件，去重
  const allFiles = [...filesFromVariables, ...(filesFromContextItems ?? [])];

  const context: SkillContext = {
    files: deduplicate(allFiles, (item) => item.fileId),
    results: deduplicate(
      resultIds.map((resultId) => ({ resultId })),
      (item) => item.resultId,
    ),
  };

  return context;
};
```

**核心设计点:**
1. **变量解析:** 工作流变量 → 文件ID映射
2. **去重合并:** 避免重复引用同一资源
3. **类型转换:** IContextItem → SkillContext

#### 5.2 上下文清理与存储优化

```typescript:321:362:packages/canvas-common/src/context.ts
export const purgeContextForActionResult = (context: SkillContext) => {
  // 移除实际内容以节省存储空间
  const contextCopy: SkillContext = safeParseJSON(JSON.stringify(context ?? {}));
  
  if (contextCopy.resources) {
    for (const { resource } of contextCopy.resources) {
      if (resource) {
        resource.content = '';  // 清空资源内容
      }
    }
  }
  
  if (contextCopy.documents) {
    for (const { document } of contextCopy.documents) {
      if (document) {
        document.content = '';  // 清空文档内容
      }
    }
  }

  if (contextCopy.codeArtifacts) {
    for (const { codeArtifact } of contextCopy.codeArtifacts) {
      if (codeArtifact) {
        codeArtifact.content = '';  // 清空代码内容
      }
    }
  }

  if (contextCopy.files) {
    for (const { file } of contextCopy.files) {
      if (file) {
        file.content = '';  // 清空文件内容
      }
    }
  }

  if (contextCopy.results) {
    for (const item of contextCopy.results) {
      item.result = undefined;  // 清空结果
    }
  }

  return contextCopy;
};
```

**存储优化策略:**
- **内容分离:** 只保留元数据和引用ID
- **懒加载:** 实际内容按需从数据库加载
- **大小控制:** 防止ActionResult表膨胀

---

### 6. Skill引擎设计：如何抽象AI能力并实现可扩展的技能系统？

#### 6.1 Skill引擎架构

Refly 的 Skill系统基于 **LangChain** 和 **LangGraph** 构建:

```typescript:1:200:packages/skill-template/src/base.ts
export abstract class BaseSkill {
  icon: Icon = { type: 'emoji', value: '🔧' };
  placeholder = '🔧';
  abstract name: string;
  abstract description: string;
  abstract configSchema: SkillTemplateConfigDefinition;
  abstract graphState: StateGraphArgs<BaseSkillState>['channels'];

  constructor(public engine: SkillEngine) {}

  // 转换为LangChain Runnable
  abstract toRunnable(): Runnable;

  // 发射技能事件
  emitEvent(data: Partial<SkillEvent>, config: SkillRunnableConfig) {
    const { emitter } = config?.configurable || {};
    if (!emitter) return;

    const eventData: SkillEvent = {
      event: data.event,
      resultId: config.configurable.resultId,
      step: config.metadata?.step,
      ...data,
    };

    // 自动推断事件类型
    if (!eventData.event) {
      if (eventData.log) eventData.event = 'log';
      else if (eventData.tokenUsage) eventData.event = 'token_usage';
      else if (eventData.structuredData) eventData.event = 'structured_data';
      else if (eventData.artifact) eventData.event = 'artifact';
      else if (eventData.toolCallResult) eventData.event = 'tool_call_stream';
    }

    emitter.emit(eventData.event, eventData);
  }

  // 分块发射大数据 (防止事件系统过载)
  async emitLargeDataEvent<T>(
    data: {
      event?: string;
      data: T[];
      buildEventData: (
        chunk: T[],
        meta: { isPartial: boolean; chunkIndex: number; totalChunks: number },
      ) => Partial<SkillEvent>;
    },
    config: SkillRunnableConfig,
    options: {
      maxChunkSize?: number;
      delayBetweenChunks?: number;
    } = {},
  ): Promise<void> {
    const { maxChunkSize = 500, delayBetweenChunks = 10 } = options;

    if (!data.data?.length || !config?.configurable?.emitter) {
      return;
    }

    // 按大小分块
    const chunks: T[][] = [];
    let currentChunk: T[] = [];
    let currentSize = 0;

    for (const item of data.data) {
      const itemSize = JSON.stringify(item).length;

      if (currentSize + itemSize > maxChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentSize = 0;
      }

      currentChunk.push(item);
      currentSize += itemSize;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    // 延迟发射
    const emitPromises = chunks.map(
      (chunk, i) =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            const eventData = data.buildEventData(chunk, {
              isPartial: i < chunks.length - 1,
              chunkIndex: i,
              totalChunks: chunks.length,
            });
            this.emitEvent(eventData, config);
            resolve();
          }, i * delayBetweenChunks);
        }),
    );

    await Promise.all(emitPromises);
  }

  async _call(
    input: BaseSkillState,
    _runManager?: CallbackManagerForToolRun,
    config?: SkillRunnableConfig,
  ): Promise<string> {
    if (!config) {
      throw new Error('skill config is required');
    }

    // 配置引擎
    this.engine.configure(config);

    // 设置当前技能
    config.configurable.currentSkill ??= {
      name: this.name,
      icon: this.icon,
    };

    // 预处理查询和上下文
    config.configurable.preprocessResult ??= await preprocess(
      input.query, 
      config, 
      this.engine
    );

    const response = await this.toRunnable().invoke(input, {
      ...config,
      metadata: {
        ...config.metadata,
        ...config.configurable.currentSkill,
        resultId: config.configurable.resultId,
      },
    });

    return response;
  }
}
```

#### 6.2 SkillEngine 接口设计

为了避免循环依赖，Refly 在 `common-types` 包中定义了最小接口:

```typescript:1:125:packages/common-types/src/skill-engine.ts
export interface ISkillEngine {
  /**
   * 创建聊天模型实例
   * @param params - 模型参数 (temperature, topP, maxTokens等)
   * @param scene - 场景类型 ('chat' | 'copilot' | 'agent' | 'titleGeneration')
   * @returns LangChain BaseChatModel实例
   */
  chatModel(params?: ChatModelParams, scene?: ModelScene): any;

  /** Refly服务实例 (文件操作等) */
  service?: any;

  /** 日志实例 */
  logger?: ILogger;

  /** 配置引擎运行时配置 */
  configure?(config: any): void;

  /** 获取配置值 */
  getConfig?(key?: string): any;
}

export interface ChatModelParams {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  [key: string]: any;
}

export type ModelScene = 
  | 'chat'              // 对话场景
  | 'copilot'           // Copilot辅助
  | 'agent'             // Agent自主决策
  | 'titleGeneration'   // 标题生成
  | 'queryAnalysis';    // 查询分析

export interface ILogger {
  log(message: any, ...optionalParams: any[]): void;
  error(message: any, ...optionalParams: any[]): void;
  warn(message: any, ...optionalParams: any[]): void;
  debug(message: any, ...optionalParams: any[]): void;
}
```

**设计亮点:**
1. **最小接口:** 只暴露必要的方法，降低耦合
2. **类型安全:** 使用 TypeScript 泛型确保类型正确
3. **场景区分:** 不同场景使用不同的模型配置

#### 6.3 ReflyService - 服务集成层

```typescript:91:283:apps/api/src/modules/skill/skill-engine.service.ts
buildReflyService = (): ReflyService => {
  return {
    getUserMediaConfig: async (user, mediaType) => {
      return await this.providerService.getUserMediaConfig(user, mediaType);
    },
    generateMedia: async (user, req) => {
      return await this.mediaGeneratorService.generate(user, req);
    },
    getActionResult: async (user, req) => {
      return await this.actionService.getActionResult(user, req);
    },
    createCanvas: async (user, req) => {
      const canvas = await this.canvasService.createCanvas(user, req);
      const canvasDTO = canvasPO2DTO(canvas);
      if (canvasDTO.usedToolsets && canvasDTO.usedToolsets.length > 0) {
        canvasDTO.usedToolsets = await this.toolService.populateToolsetsWithDefinition(
          canvasDTO.usedToolsets,
        );
      }
      return buildSuccessResponse(canvasDTO);
    },
    webSearch: async (user, req) => {
      return await this.searchService.webSearch(user, req);
    },
    rerank: async (user, query, results, options) => {
      return await this.ragService.rerank(user, query, results, options);
    },
    librarySearch: async (user, req, options) => {
      return await this.searchService.search(user, req, options);
    },
    crawlUrl: async (user, url) => {
      try {
        const parserFactory = new ParserFactory(this.config, this.providerService);
        const jinaParser = await parserFactory.createWebParser(user, {
          resourceId: `temp-${Date.now()}`,
        });
        const result = await jinaParser.parse(url);
        return {
          title: result.title,
          content: result.content,
          metadata: { ...result.metadata, url },
        };
      } catch (error) {
        this.logger.error(`Failed to crawl URL ${url}: ${error.stack}`);
        return { title: '', content: '', metadata: { url, error: error.message } };
      }
    },
    uploadFile: async (user, param) => {
      return await this.miscService.uploadFile(user, param);
    },
    readFile: async (user, fileId) => {
      return await this.driveService.getDriveFileDetail(user, fileId);
    },
    writeFile: async (user, param) => {
      return await this.driveService.createDriveFile(user, param);
    },
    execute: async (user, req) => {
      return await this.scaleboxService.execute(user, req);
    },
    // ... 更多服务方法
  };
};
```

**服务层职责:**
- **统一入口:** 为Skill提供统一的业务能力访问接口
- **依赖注入:** 通过NestJS的ModuleRef动态获取服务实例
- **错误处理:** 集中处理异常并返回标准响应

---

### 7. 工具系统设计：如何实现可插拔的Tool生态？

#### 7.1 工具抽象层

Refly 基于 LangChain 的 `StructuredTool` 实现了三层工具抽象:

```typescript:1:218:packages/agent-tools/src/base.ts
/**
 * 工具调用结果
 */
export interface ToolCallResult {
  status: 'success' | 'error';
  data?: any;
  error?: string;
  summary?: string;
  creditCost?: number;  // 信用成本
  files?: DriveFile[];
}

/**
 * 工具类型
 */
export type ToolType =
  | 'builtin'          // 内置工具
  | 'regular'          // 常规工具
  | 'dynamic'          // 动态工具
  | 'composio'         // Composio集成
  | 'mcp'              // MCP协议工具
  | 'config_based'     // 配置驱动工具
  | 'external_api'     // 外部API
  | 'external_oauth';  // OAuth认证外部API

/**
 * 工具基类
 */
export abstract class AgentBaseTool<TParams = unknown> extends StructuredTool {
  /** 工具集key */
  abstract toolsetKey: string;

  /** 工具类型 */
  toolType: ToolType = 'regular';

  constructor(_params?: TParams) {
    super();
  }
}

/**
 * 工具集基类
 */
export abstract class AgentBaseToolset<TParams = unknown> {
  /** 工具集key */
  abstract toolsetKey: string;

  /** 工具构造器数组 */
  abstract tools: readonly AgentToolConstructor<TParams>[];

  /** 工具集参数 */
  protected params?: TParams;

  /** 延迟创建的工具实例 */
  protected toolInstances: AgentBaseTool<TParams>[] = [];

  constructor(params?: TParams) {
    this.params = params;
  }

  /**
   * 初始化工具实例
   */
  initializeTools(params?: TParams): AgentBaseTool<TParams>[] {
    const effectiveParams = (params ?? this.params) as TParams | undefined;

    if (effectiveParams === undefined && (this.tools?.length ?? 0) > 0) {
      // 尝试无参构造
      this.toolInstances = this.tools
        ?.map((Ctor) => {
          try {
            const NoArgCtor = Ctor as new () => AgentBaseTool<TParams>;
            return new NoArgCtor();
          } catch {
            return undefined;
          }
        })
        ?.filter((tool): tool is AgentBaseTool<TParams> => tool != null) ?? [];
      return this.toolInstances;
    }

    // 带参构造
    this.toolInstances = (this.tools ?? [])
      .map((Ctor) => {
        const WithArgCtor = Ctor as new (p: TParams) => AgentBaseTool<TParams>;
        return new WithArgCtor(effectiveParams as TParams);
      })
      .filter((tool): tool is AgentBaseTool<TParams> => tool != null);

    return this.toolInstances;
  }

  /**
   * 根据名称获取工具实例
   */
  getToolInstance(name: string): AgentBaseTool<TParams> {
    if (!this.toolInstances?.length) {
      this.initializeTools();
    }

    const toolInstance = this.toolInstances?.find((tool) => tool?.name === name);
    if (!toolInstance) {
      throw new Error(`Tool instance ${name} not found`);
    }
    return toolInstance;
  }

  /**
   * 查找工具构造器 (不实例化)
   */
  getToolConstructor(name: string): AgentToolConstructor<TParams> {
    const tools = this.tools ?? ([] as unknown as readonly AgentToolConstructor<TParams>[]);
    const ctor = tools.find((Ctor) => {
      try {
        const NoArgCtor = Ctor as new () => AgentBaseTool<TParams>;
        const tmp = new NoArgCtor();
        return tmp?.name === name;
      } catch {
        return (
          ((Ctor as unknown as { prototype?: { name?: string } })?.prototype?.name ?? '') === name
        );
      }
    });

    if (!ctor) {
      throw new Error(`Tool ${name} not found in toolset ${this.toolsetKey}`);
    }

    return ctor as AgentToolConstructor<TParams>;
  }
}

/**
 * 基础工具参数
 */
export interface BaseToolParams {
  reflyService?: ReflyService;
  isGlobalToolset?: boolean;
  engine?: ISkillEngine;  // SkillEngine实例 (用于LLM调用)
}
```

**关键设计点:**

1. **泛型参数化:** `TParams` 支持不同工具的自定义参数
2. **延迟实例化:** 工具实例按需创建，节省资源
3. **构造器灵活性:** 支持有参/无参构造，兼容不同场景

#### 7.2 沙箱Agent工具示例

```typescript:1:154:packages/sandbox-agent/src/chains.ts
/**
 * 使用LLM检查代码是否修改文件
 */
export async function getFileModifications(
  code: string,
  llm: BaseChatModel,
): Promise<string[] | null> {
  // 1. 快速启发式检查
  const fileOperationPatterns = [
    /\.to_csv\(/,
    /\.to_excel\(/,
    /\.to_json\(/,
    /\.savefig\(/,
    /with open\(/,
    /open\(['"](.*?)['"]/,
    /\.write\(/,
    /\.dump\(/,
  ];

  const hasFileOperations = fileOperationPatterns.some((pattern) => pattern.test(code));

  if (!hasFileOperations) {
    return null;
  }

  try {
    // 2. 使用LLM进行深度分析
    const chain = DETERMINE_MODIFICATIONS_PROMPT.pipe(llm);
    const response = await chain.invoke({ code });

    if (typeof response.content === 'string') {
      const modifications = parseModifications(response.content);
      return modifications;
    }
  } catch (error) {
    console.error('Error determining modifications with LLM:', error);
  }

  // 3. 回退：正则提取文件名
  const filenameMatches = [
    ...code.matchAll(/['"]([\w\-\.]+\.(?:csv|xlsx|json|png|jpg|jpeg|pdf|txt|html))['"]/gi),
  ];

  if (filenameMatches.length === 0) {
    return null;
  }

  const filenames = filenameMatches.map((match) => match[1]);
  return [...new Set(filenames)]; // 去重
}

/**
 * 使用LLM移除下载链接
 */
export async function removeDownloadLink(text: string, llm: BaseChatModel): Promise<string> {
  try {
    const chain = REMOVE_DL_LINK_PROMPT.pipe(llm);
    const response = await chain.invoke({ input_response: text });

    if (typeof response.content === 'string') {
      return response.content;
    }
  } catch (error) {
    console.error('Error removing download link with LLM:', error);
  }

  // 回退：基于正则的清理
  return extractCleanResponse(text);
}

/**
 * 分析代码潜在问题
 */
export async function analyzeCode(
  code: string,
  llm: BaseChatModel,
): Promise<{ hasIssues: boolean; issues: string[] }> {
  const prompt = ChatPromptTemplate.fromMessages([
    [
      'system',
      'You are a code analysis assistant. Analyze the given Python code for potential issues, errors, or improvements.',
    ],
    ['human', 'Analyze this Python code and list any potential issues:\n\n```python\n{code}\n```'],
  ]);

  try {
    const chain = prompt.pipe(llm);
    const response = await chain.invoke({ code });

    if (typeof response.content === 'string') {
      const content = response.content.toLowerCase();
      const hasIssues =
        content.includes('issue') || content.includes('error') || content.includes('problem');

      return {
        hasIssues,
        issues: hasIssues ? [response.content] : [],
      };
    }
  } catch (error) {
    console.error('Error analyzing code:', error);
  }

  return { hasIssues: false, issues: [] };
}

/**
 * 生成代码建议
 */
export async function generateCodeSuggestion(
  userRequest: string,
  llm: BaseChatModel,
): Promise<string> {
  const prompt = ChatPromptTemplate.fromMessages([
    [
      'system',
      'You are a helpful Python coding assistant. Generate Python code to fulfill user requests.',
    ],
    ['human', 'Generate Python code for the following request:\n\n{request}'],
  ]);

  const chain = prompt.pipe(llm);
  const response = await chain.invoke({ request: userRequest });

  if (typeof response.content === 'string') {
    return extractPythonCode(response.content);
  }

  return '';
}
```

**工具设计模式:**
1. **启发式+LLM混合:** 先快速检查，再精确分析
2. **回退机制:** LLM失败时使用正则表达式
3. **安全隔离:** 代码执行在沙箱环境 (Scalebox)

---

### 8. 状态同步机制：前端Canvas与后端数据库如何实时同步？

#### 8.1 增量同步协议

Refly 使用 **事务式差分同步** (Transaction-based Diff Sync):

```typescript
// 核心数据结构
interface SyncTransaction {
  txId: string;
  createdAt: number;
  syncedAt: number;
  source: { type: 'user' | 'system' };
  nodeDiffs: NodeDiff[];    // 节点变更
  edgeDiffs: EdgeDiff[];    // 边变更
}

type NodeDiff = 
  | { type: 'add'; node: CanvasNode }
  | { type: 'update'; id: string; from?: Partial<CanvasNode>; to: Partial<CanvasNode> }
  | { type: 'delete'; id: string; node?: CanvasNode };
```

**同步流程:**

```typescript:268:282:apps/api/src/modules/workflow/workflow.service.ts
private async syncNodeDiffToCanvas(user: User, canvasId: string, nodeDiffs: NodeDiff[]) {
  await this.canvasSyncService.syncState(user, {
    canvasId,
    transactions: [
      {
        txId: genTransactionId(),
        createdAt: Date.now(),
        syncedAt: Date.now(),
        source: { type: 'system' },
        nodeDiffs,
        edgeDiffs: [],
      },
    ],
  });
}
```

**优势:**
1. **增量更新:** 只传输变更部分，减少网络开销
2. **冲突解决:** 通过 txId 和时间戳检测并解决冲突
3. **事务性:** 保证多个变更的原子性

#### 8.2 实时通知 (WebSocket/SSE)

工作流执行过程中，通过事件流向前端推送进度:

```typescript:67:96:packages/skill-template/src/base.ts
emitEvent(data: Partial<SkillEvent>, config: SkillRunnableConfig) {
  const { emitter } = config?.configurable || {};

  if (!emitter) {
    return;
  }

  const eventData: SkillEvent = {
    event: data.event,
    resultId: config.configurable.resultId,
    step: config.metadata?.step,
    ...data,
  };

  // 自动推断事件类型
  if (!eventData.event) {
    if (eventData.log) {
      eventData.event = 'log';
    } else if (eventData.tokenUsage) {
      eventData.event = 'token_usage';
    } else if (eventData.structuredData) {
      eventData.event = 'structured_data';
    } else if (eventData.artifact) {
      eventData.event = 'artifact';
    } else if (eventData.toolCallResult) {
      eventData.event = 'tool_call_stream';
    }
  }

  emitter.emit(eventData.event, eventData);
}
```

**事件类型:**
- `log`: 执行日志
- `token_usage`: Token消耗统计
- `artifact`: 生成的制品 (代码、图片等)
- `tool_call_stream`: 工具调用进度

---

### 9. 错误处理与容错：如何保证工作流的健壮性？

#### 9.1 超时与重试机制

```typescript:43:46:apps/api/src/modules/workflow/workflow.service.ts
const WORKFLOW_POLL_INTERVAL = 1500;
const WORKFLOW_EXECUTION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const NODE_EXECUTION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const POLL_LOCK_TTL_MS = 5000; // 5 seconds
```

**超时处理逻辑:**

```typescript:564:591:apps/api/src/modules/workflow/workflow.service.ts
// 检查工作流超时
const executionAge = Date.now() - workflowExecution.createdAt.getTime();
if (executionAge > WORKFLOW_EXECUTION_TIMEOUT_MS) {
  this.logger.warn(
    `[pollWorkflow] Workflow ${executionId} timed out after ${executionAge}ms (limit: ${WORKFLOW_EXECUTION_TIMEOUT_MS}ms)`,
  );

  // 标记所有未完成节点为失败
  await this.prisma.workflowNodeExecution.updateMany({
    where: {
      executionId,
      status: { notIn: ['finish', 'failed'] },
    },
    data: {
      status: 'failed',
      errorMessage: `Workflow execution timeout exceeded (${Math.floor(executionAge / 1000)}s)`,
      endTime: new Date(),
    },
  });

  // 标记工作流为失败并停止轮询
  await this.prisma.workflowExecution.update({
    where: { executionId },
    data: { status: 'failed' },
  });

  this.logger.error(`[pollWorkflow] Workflow ${executionId} marked as failed due to timeout`);
  return;
}
```

**节点级超时:**

```typescript:612:632:apps/api/src/modules/workflow/workflow.service.ts
// 检查卡住的执行节点并超时
const now = new Date();
const stuckExecutingNodes = allNodes.filter((n) => {
  if (n.status !== 'executing' || !n.startTime) return false;
  const nodeAge = now.getTime() - n.startTime.getTime();
  return nodeAge > NODE_EXECUTION_TIMEOUT_MS;
});

if (stuckExecutingNodes.length > 0) {
  const timedOutNodeIds = stuckExecutingNodes.map((n) => n.nodeExecutionId);
  await this.prisma.workflowNodeExecution.updateMany({
    where: { nodeExecutionId: { in: timedOutNodeIds } },
    data: {
      status: 'failed',
      errorMessage: `Node execution timeout exceeded (${Math.floor(NODE_EXECUTION_TIMEOUT_MS / 1000)}s)`,
      endTime: now,
    },
  });
  this.logger.warn(
    `[pollWorkflow] Marked ${stuckExecutingNodes.length} nodes as failed due to timeout in execution ${executionId}`,
  );
}
```

#### 9.2 失败传播控制

Refly 采用 **局部失败不阻塞全局** 的策略:

```typescript:745:780:apps/api/src/modules/workflow/workflow.service.ts
// 计算节点统计
const executedNodes = allNodes.filter(n => n.status === 'finish').length;
const failedNodes = allNodes.filter(n => n.status === 'failed').length;
const pendingNodes = allNodes.filter(n => 
  n.status === 'init' || n.status === 'waiting'
).length;
const executingNodes = allNodes.filter(n => n.status === 'executing').length;

// 确定工作流状态
let newStatus: 'executing' | 'failed' | 'finish' = 'executing';
if (failedNodes > 0) {
  newStatus = 'failed';  // 任一节点失败则工作流失败
} else if (pendingNodes === 0 && executingNodes === 0) {
  newStatus = 'finish';  // 所有节点完成
}
```

**失败策略:**
1. **快速失败:** 一旦有节点失败，立即标记工作流失败
2. **状态隔离:** 失败节点不影响已完成节点的结果
3. **日志保留:** 所有错误信息保存到 `errorMessage` 字段

---

### 10. 可扩展性设计：如何支持自定义Skill和第三方集成？

#### 10.1 Skill模板系统

Refly 通过抽象基类 `BaseSkill` 实现Skill扩展:

```typescript
// 开发者只需实现这些方法
export abstract class BaseSkill {
  abstract name: string;
  abstract description: string;
  abstract configSchema: SkillTemplateConfigDefinition;
  abstract graphState: StateGraphArgs<BaseSkillState>['channels'];
  abstract toRunnable(): Runnable;
}
```

**示例: 自定义QnA Skill**

```typescript
export class CustomQnASkill extends BaseSkill {
  name = 'customQnA';
  description = '自定义问答技能';
  
  configSchema = {
    // 配置项定义
    promptTemplate: { type: 'string', required: false },
    temperature: { type: 'number', default: 0.7 },
  };

  graphState = {
    query: { value: (x, y) => y ?? x },
    context: { value: (x, y) => y ?? x },
    answer: { value: (x, y) => y ?? x },
  };

  toRunnable(): Runnable {
    const llm = this.engine.chatModel({ temperature: 0.7 });
    
    return RunnableSequence.from([
      // 1. 预处理输入
      RunnableLambda.from((input) => ({
        ...input,
        processedQuery: this.preprocessQuery(input.query),
      })),
      
      // 2. 调用LLM
      ChatPromptTemplate.fromTemplate('{processedQuery}').pipe(llm),
      
      // 3. 后处理输出
      RunnableLambda.from((output) => this.postprocessOutput(output)),
    ]);
  }
}
```

#### 10.2 第三方工具集成

**支持的集成类型:**

```typescript:9:18:packages/agent-tools/src/base.ts
export type ToolType =
  | 'builtin'          // 内置工具
  | 'regular'          // 常规工具
  | 'dynamic'          // 动态工具
  | 'composio'         // Composio平台集成
  | 'mcp'              // Model Context Protocol
  | 'config_based'     // 配置驱动工具
  | 'external_api'     // 外部API直接调用
  | 'external_oauth';  // OAuth认证的外部API
```

**集成流程:**

1. **定义工具类:**
```typescript
export class MyCustomTool extends AgentBaseTool<MyToolParams> {
  toolsetKey = 'my-custom-toolset';
  name = 'my_tool';
  description = '我的自定义工具';

  async _call(input: any): Promise<ToolCallResult> {
    try {
      const result = await this.callExternalAPI(input);
      return {
        status: 'success',
        data: result,
        summary: '执行成功',
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
      };
    }
  }
}
```

2. **注册工具集:**
```typescript
export class MyCustomToolset extends AgentBaseToolset<MyToolParams> {
  toolsetKey = 'my-custom-toolset';
  tools = [MyCustomTool] as const;
}
```

3. **前端配置:**
```yaml
toolsets:
  - key: my-custom-toolset
    name: 我的工具集
    icon: { type: 'emoji', value: '🛠️' }
    tools:
      - name: my_tool
        displayName: 我的工具
        parameters:
          apiKey: ${env.MY_API_KEY}
```

---

## 总结与启发

### 核心优势

1. **前后端一致性:** 通过 Monorepo 和共享包确保逻辑一致
2. **可视化编排:** Canvas + @xyflow/react 提供直观的工作流设计体验
3. **分布式调度:** BullMQ + Redis 实现高可用的任务调度
4. **AI能力抽象:** SkillEngine 统一管理 LLM 调用和 Token 计费
5. **工具生态开放:** 基于 LangChain 的工具系统易于扩展

### 可借鉴的设计模式

1. **事务式差分同步:** 高效的前后端状态同步方案
2. **拓扑排序调度:** 优雅的DAG执行顺序管理
3. **轮询+队列混合架构:** 平衡实时性与资源消耗
4. **分层上下文管理:** 工作流变量 → 节点上下文 → Skill输入
5. **最小接口设计:** 通过 `common-types` 打破循环依赖

### 潜在改进方向

1. **DAG可视化增强:** 支持更复杂的条件分支和循环结构
2. **调试能力:** 增加断点、单步执行、变量查看等功能
3. **版本控制:** 工作流版本管理和回滚机制
4. **性能优化:** 大规模工作流的并发执行优化
5. **监控告警:** 实时监控工作流健康状态和资源消耗

---

## 参考资料

- **源码仓库:** https://github.com/refly-ai/refly
- **官方文档:** https://docs.refly.ai/
- **技术栈:**
  - LangChain: https://js.langchain.com/
  - LangGraph: https://langchain-ai.github.io/langgraphjs/
  - NestJS: https://nestjs.com/
  - @xyflow/react: https://reactflow.dev/
  - BullMQ: https://docs.bullmq.io/

---

**生成时间:** 2024-12-22  
**分析版本:** Refly v1.0.0  
**文档作者:** AgenticX Research Team

---

## 核心工程化追问：AgenticX 的落地路径

基于对 Refly.AI 的深度分析，结合 AgenticX 项目的实际需求，以下5个核心追问将指导我们的技术选型和架构设计：

### 追问1：工作流调度引擎 - 轮询 vs 事件驱动，如何选择？

**Refly 的方案：**
- 使用 **轮询机制** (Poll Workflow)，每1.5秒检查一次工作流状态
- 优点：实现简单，容错性好，易于调试
- 缺点：存在延迟（最高1.5秒），高并发下 Redis 压力大，资源利用率不够高

**AgenticX 的思考方向：**

```typescript
// 方案A: 纯事件驱动 (优化延迟)
class EventDrivenWorkflowScheduler {
  // 节点完成时立即触发下游节点
  async onNodeComplete(nodeId: string, executionId: string) {
    const childNodes = await this.getReadyChildNodes(nodeId);
    await Promise.all(
      childNodes.map(child => this.runWorkflowQueue.add(child))
    );
  }
  
  // 优点: 零延迟，实时性强
  // 缺点: 需要完善的事件总线，故障恢复复杂
}

// 方案B: 混合模式 (平衡性能与可靠性)
class HybridWorkflowScheduler {
  // 正常流程: 事件驱动
  async onNodeComplete(nodeId: string) {
    await this.triggerChildNodesImmediately(nodeId);
  }
  
  // 兜底机制: 定期轮询检查遗漏
  @Cron('*/10 * * * * *')  // 每10秒轮询一次
  async pollStuckWorkflows() {
    const stuckExecutions = await this.findStuckExecutions();
    // 恢复卡住的工作流
  }
}
```

**关键决策点：**
1. **实时性要求多高？** 金融场景需要<100ms 响应，可视化工具可以容忍1-2秒延迟
2. **并发规模多大？** 单机100并发用轮询即可，10000+并发必须事件驱动
3. **容错需求如何？** 关键业务流程需要轮询兜底，确保不遗漏任务

**AgenticX 建议：**
- **初期**：使用轮询（0.5-1秒间隔），快速验证业务逻辑
- **优化期**：引入事件驱动，保留轮询作为兜底机制
- **成熟期**：基于 Kafka/Pulsar 的完全事件驱动架构

---

### 追问2：超大上下文管理 - 如何突破百万 Token 限制？

**Refly 的方案：**
- 上下文清理：只保留元数据和引用 ID
- 懒加载：内容按需从数据库加载
- 局限性：单个节点上下文仍受 LLM Token 限制（通常 32k-200k）

**AgenticX 的突破方向：**

```python
# 方案A: 分层上下文压缩 (Hierarchical Context Compression)
class LayeredContextManager:
    def __init__(self):
        self.l1_cache = {}  # 热数据：最近访问的完整上下文
        self.l2_cache = {}  # 温数据：压缩后的摘要
        self.l3_storage = {}  # 冷数据：仅保留引用
    
    async def get_context_for_node(self, node_id: str, max_tokens: int) -> Context:
        """智能上下文组装"""
        # 1. 获取直接父节点的完整输出（L1缓存）
        parent_outputs = await self.get_from_l1(node_id)
        
        # 2. 获取间接依赖节点的摘要（L2缓存）
        ancestor_summaries = await self.get_from_l2(node_id)
        
        # 3. 根据 Token 预算动态裁剪
        context = self.assemble_context(
            parent_outputs, 
            ancestor_summaries,
            max_tokens=max_tokens * 0.7  # 预留30%给新生成
        )
        
        return context

# 方案B: 动态上下文检索 (RAG-based Context Retrieval)
class RAGContextManager:
    async def retrieve_relevant_context(
        self, 
        query: str, 
        execution_id: str,
        max_tokens: int
    ) -> Context:
        """基于查询的上下文检索"""
        # 1. 将所有历史节点输出向量化存储
        all_history = await self.vector_store.query(
            collection=f"execution_{execution_id}",
            query_embedding=self.embed(query),
            top_k=50
        )
        
        # 2. 使用 Rerank 模型精排
        reranked = await self.rerank_model.rank(
            query=query,
            documents=all_history,
            top_k=10
        )
        
        # 3. 动态填充到 Token 预算
        context = self.fill_to_budget(reranked, max_tokens)
        
        return context
```

**工程化挑战：**

| 挑战 | Refly 方案 | AgenticX 改进 |
|------|-----------|--------------|
| 上下文膨胀 | 手动清理 | 自动压缩 + TTL过期策略 |
| 关键信息丢失 | 依赖开发者标注 | 基于重要性评分的智能保留 |
| 跨节点引用 | 简单ID引用 | 语义化引用 + 自动解引用 |
| Token 计费 | 全量计费 | 增量计费（只计算新增部分） |

**AgenticX 实施路线：**
1. **Phase 1**：实现 Refly 的清理机制（保留元数据）
2. **Phase 2**：引入上下文摘要（使用小模型生成 Summary）
3. **Phase 3**：构建向量化存储 + RAG 检索
4. **Phase 4**：实现自适应上下文组装（根据任务类型动态调整策略）

---

### 追问3：工具系统标准化 - 如何兼容 MCP/LangChain/OpenAI Function Calling？

**Refly 的方案：**
- 基于 LangChain 的 `StructuredTool`
- 支持多种工具类型（builtin, mcp, composio等）
- 局限性：不同工具协议间的转换成本高，工具发现机制不够智能

**AgenticX 的统一抽象层：**

```python
# 核心抽象：工具协议适配器
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from pydantic import BaseModel

class ToolParameter(BaseModel):
    """统一的工具参数定义"""
    name: str
    type: str  # string, number, boolean, object, array
    description: str
    required: bool = False
    enum: Optional[List[Any]] = None
    default: Optional[Any] = None

class ToolDefinition(BaseModel):
    """统一的工具定义"""
    name: str
    description: str
    parameters: List[ToolParameter]
    returns: Dict[str, Any]
    
    # 扩展元数据
    category: str  # search, data_processing, code_execution...
    cost_per_call: Optional[float] = None  # 计费信息
    rate_limit: Optional[int] = None  # 限流配置
    timeout_ms: int = 30000  # 超时时间

class ToolAdapter(ABC):
    """工具协议适配器基类"""
    
    @abstractmethod
    async def discover_tools(self) -> List[ToolDefinition]:
        """发现可用工具"""
        pass
    
    @abstractmethod
    async def invoke_tool(
        self, 
        tool_name: str, 
        parameters: Dict[str, Any]
    ) -> Any:
        """调用工具"""
        pass

# 适配器实现示例
class MCPAdapter(ToolAdapter):
    """MCP 协议适配器"""
    
    async def discover_tools(self) -> List[ToolDefinition]:
        # 从 MCP Server 获取工具列表
        mcp_tools = await self.mcp_client.list_tools()
        
        # 转换为统一格式
        return [
            ToolDefinition(
                name=tool.name,
                description=tool.description,
                parameters=self._convert_mcp_schema(tool.inputSchema),
                returns={"type": "object"},
                category=self._infer_category(tool)
            )
            for tool in mcp_tools
        ]
    
    async def invoke_tool(self, tool_name: str, parameters: Dict) -> Any:
        result = await self.mcp_client.call_tool(tool_name, parameters)
        return result.content

class LangChainAdapter(ToolAdapter):
    """LangChain 工具适配器"""
    
    def __init__(self, langchain_tools: List[BaseTool]):
        self.tools = langchain_tools
    
    async def discover_tools(self) -> List[ToolDefinition]:
        return [
            ToolDefinition(
                name=tool.name,
                description=tool.description,
                parameters=self._convert_langchain_schema(tool.args_schema),
                returns={"type": "any"},
                category="general"
            )
            for tool in self.tools
        ]

class OpenAIFunctionAdapter(ToolAdapter):
    """OpenAI Function Calling 适配器"""
    
    async def discover_tools(self) -> List[ToolDefinition]:
        # OpenAI functions 已经是标准格式
        return [
            ToolDefinition(**func_def)
            for func_def in self.function_definitions
        ]

# 统一工具注册中心
class ToolRegistry:
    def __init__(self):
        self.adapters: List[ToolAdapter] = []
        self.tool_cache: Dict[str, ToolDefinition] = {}
    
    def register_adapter(self, adapter: ToolAdapter):
        """注册工具适配器"""
        self.adapters.append(adapter)
    
    async def discover_all_tools(self) -> List[ToolDefinition]:
        """发现所有可用工具"""
        all_tools = []
        for adapter in self.adapters:
            tools = await adapter.discover_tools()
            all_tools.extend(tools)
        
        # 去重 + 缓存
        unique_tools = self._deduplicate_tools(all_tools)
        self.tool_cache = {tool.name: tool for tool in unique_tools}
        
        return unique_tools
    
    async def invoke(self, tool_name: str, parameters: Dict) -> Any:
        """智能路由工具调用"""
        if tool_name not in self.tool_cache:
            raise ToolNotFoundError(f"Tool {tool_name} not found")
        
        # 找到对应的适配器并调用
        for adapter in self.adapters:
            if await adapter.has_tool(tool_name):
                return await adapter.invoke_tool(tool_name, parameters)
```

**工具发现与推荐机制：**

```python
class IntelligentToolSelector:
    """智能工具选择器"""
    
    def __init__(self, registry: ToolRegistry):
        self.registry = registry
        self.embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
    
    async def select_tools_for_task(
        self, 
        task_description: str,
        max_tools: int = 5
    ) -> List[ToolDefinition]:
        """基于任务描述智能选择工具"""
        # 1. 获取所有工具
        all_tools = await self.registry.discover_all_tools()
        
        # 2. 计算语义相似度
        task_embedding = self.embedding_model.encode(task_description)
        tool_embeddings = self.embedding_model.encode(
            [f"{tool.name}: {tool.description}" for tool in all_tools]
        )
        
        # 3. 相似度排序
        similarities = cosine_similarity([task_embedding], tool_embeddings)[0]
        top_indices = similarities.argsort()[-max_tools:][::-1]
        
        # 4. 返回推荐工具
        return [all_tools[i] for i in top_indices if similarities[i] > 0.3]
```

**AgenticX 优势：**
1. **协议无关**：通过适配器模式支持任意工具协议
2. **智能发现**：基于语义相似度的工具推荐
3. **统一计费**：在抽象层统一处理成本和限流
4. **可观测性**：所有工具调用都经过统一监控点

---

### 追问4：分布式容错 - 工作流如何从故障中恢复？

**Refly 的方案：**
- 超时检测 + 失败标记
- 分布式锁防止重复执行
- 局限性：节点失败后无法自动重试，缺少检查点机制

**AgenticX 的增强容错设计：**

```python
from enum import Enum
from dataclasses import dataclass
from typing import Optional

class NodeFailurePolicy(Enum):
    """节点失败策略"""
    FAIL_FAST = "fail_fast"          # 立即失败，停止工作流
    RETRY = "retry"                   # 自动重试
    SKIP = "skip"                     # 跳过节点，继续执行
    FALLBACK = "fallback"             # 使用备用节点
    MANUAL_INTERVENTION = "manual"    # 人工介入

@dataclass
class CheckpointData:
    """检查点数据"""
    execution_id: str
    node_id: str
    state: Dict[str, Any]  # 节点状态快照
    timestamp: int
    retry_count: int

class FaultTolerantWorkflowEngine:
    def __init__(self):
        self.checkpoint_store = CheckpointStore()  # 检查点存储
        self.dead_letter_queue = DeadLetterQueue()  # 死信队列
    
    async def execute_node_with_recovery(
        self, 
        node: WorkflowNode,
        execution_context: ExecutionContext
    ) -> NodeResult:
        """带恢复能力的节点执行"""
        
        # 1. 检查是否有检查点（从故障恢复）
        checkpoint = await self.checkpoint_store.get(
            execution_id=execution_context.execution_id,
            node_id=node.id
        )
        
        if checkpoint:
            # 从检查点恢复
            execution_context.restore_from_checkpoint(checkpoint)
        
        # 2. 执行节点（带重试逻辑）
        max_retries = node.failure_policy.get('max_retries', 3)
        retry_count = checkpoint.retry_count if checkpoint else 0
        
        for attempt in range(retry_count, max_retries + 1):
            try:
                # 创建检查点
                await self.checkpoint_store.save(CheckpointData(
                    execution_id=execution_context.execution_id,
                    node_id=node.id,
                    state=execution_context.to_dict(),
                    timestamp=time.time(),
                    retry_count=attempt
                ))
                
                # 执行节点
                result = await self.execute_node(node, execution_context)
                
                # 成功，删除检查点
                await self.checkpoint_store.delete(
                    execution_context.execution_id, 
                    node.id
                )
                
                return result
                
            except RecoverableError as e:
                # 可恢复错误，执行重试逻辑
                if attempt < max_retries:
                    # 指数退避
                    await asyncio.sleep(2 ** attempt)
                    continue
                else:
                    # 达到最大重试次数
                    return await self.handle_final_failure(
                        node, 
                        execution_context, 
                        e
                    )
            
            except UnrecoverableError as e:
                # 不可恢复错误，直接失败
                return await self.handle_final_failure(
                    node, 
                    execution_context, 
                    e
                )
    
    async def handle_final_failure(
        self, 
        node: WorkflowNode,
        context: ExecutionContext,
        error: Exception
    ) -> NodeResult:
        """处理最终失败"""
        
        policy = node.failure_policy.get('on_final_failure', NodeFailurePolicy.FAIL_FAST)
        
        if policy == NodeFailurePolicy.FAIL_FAST:
            # 快速失败，停止整个工作流
            await self.abort_workflow(context.execution_id)
            raise WorkflowFailedError(f"Node {node.id} failed: {error}")
        
        elif policy == NodeFailurePolicy.SKIP:
            # 跳过节点，标记为失败但继续执行
            return NodeResult(
                status='skipped',
                output=None,
                error=str(error)
            )
        
        elif policy == NodeFailurePolicy.FALLBACK:
            # 执行备用节点
            fallback_node_id = node.failure_policy.get('fallback_node_id')
            fallback_node = await self.get_node(fallback_node_id)
            return await self.execute_node(fallback_node, context)
        
        elif policy == NodeFailurePolicy.MANUAL_INTERVENTION:
            # 发送通知，等待人工介入
            await self.dead_letter_queue.add({
                'execution_id': context.execution_id,
                'node_id': node.id,
                'error': str(error),
                'context': context.to_dict()
            })
            return NodeResult(status='pending_manual_review')

# 工作流级别的容错
class WorkflowRecoveryManager:
    """工作流恢复管理器"""
    
    async def recover_stuck_workflows(self):
        """恢复卡住的工作流（定时任务）"""
        # 1. 查找超时的执行
        stuck_executions = await self.find_stuck_executions()
        
        for execution in stuck_executions:
            # 2. 加载最新检查点
            checkpoints = await self.checkpoint_store.get_all(execution.id)
            
            # 3. 重建执行状态
            recovered_state = self.rebuild_state_from_checkpoints(checkpoints)
            
            # 4. 从失败点继续执行
            await self.resume_workflow(execution.id, recovered_state)
    
    async def resume_workflow(
        self, 
        execution_id: str, 
        state: ExecutionState
    ):
        """恢复工作流执行"""
        # 找到所有未完成的节点
        pending_nodes = state.get_pending_nodes()
        
        # 重新调度
        for node in pending_nodes:
            if await self.check_dependencies_satisfied(node, state):
                await self.runWorkflowQueue.add({
                    'execution_id': execution_id,
                    'node_id': node.id,
                    'recovered': True
                })
```

**容错能力对比：**

| 特性 | Refly | AgenticX 增强 |
|------|-------|--------------|
| 节点重试 | ❌ 不支持 | ✅ 可配置重试策略 |
| 检查点恢复 | ❌ 不支持 | ✅ 自动检查点 + 恢复 |
| 失败策略 | 单一（快速失败） | 多策略（重试/跳过/回退/人工） |
| 状态持久化 | 部分（仅数据库） | 完整（检查点 + 状态快照） |
| 故障监控 | 基础日志 | 死信队列 + 告警 |

**工程化建议：**
1. **初期**：实现基础重试机制（指数退避）
2. **中期**：引入检查点系统，支持从故障点恢复
3. **成熟期**：构建完整的死信队列 + 人工介入流程

---

### 追问5：多用户协作冲突 - 如何处理并发编辑？

**Refly 的方案：**
- 事务式差分同步（Transaction-based Diff Sync）
- 基于时间戳的简单冲突检测
- 局限性：不支持多用户实时协作，冲突解决策略单一（后写覆盖）

**AgenticX 的协作增强：**

```python
from typing import List, Dict, Any
from enum import Enum

class ConflictResolutionStrategy(Enum):
    """冲突解决策略"""
    LAST_WRITE_WINS = "last_write_wins"      # 最后写入获胜
    FIRST_WRITE_WINS = "first_write_wins"    # 第一次写入获胜
    MERGE = "merge"                           # 智能合并
    MANUAL = "manual"                         # 人工解决

class OperationType(Enum):
    """操作类型（用于 OT 算法）"""
    INSERT = "insert"
    DELETE = "delete"
    UPDATE = "update"
    MOVE = "move"

@dataclass
class Operation:
    """协作操作"""
    type: OperationType
    path: str  # JSONPath 路径
    value: Any
    position: Optional[int] = None
    timestamp: int
    user_id: str
    version: int  # 向量时钟

class CRDTCanvas:
    """基于 CRDT 的 Canvas 协作引擎"""
    
    def __init__(self):
        # 使用 Automerge CRDT 库
        from automerge import Automerge
        self.doc = Automerge.init()
        self.operations_log: List[Operation] = []
    
    async def apply_operation(
        self, 
        operation: Operation,
        local_version: int
    ) -> CanvasData:
        """应用操作（自动处理冲突）"""
        
        # CRDT 自动合并，无需冲突检测
        if operation.type == OperationType.INSERT:
            self.doc = Automerge.change(
                self.doc,
                lambda doc: doc['nodes'].insert(
                    operation.position,
                    operation.value
                )
            )
        
        elif operation.type == OperationType.UPDATE:
            self.doc = Automerge.change(
                self.doc,
                lambda doc: self._set_by_path(
                    doc, 
                    operation.path, 
                    operation.value
                )
            )
        
        # 记录操作日志
        self.operations_log.append(operation)
        
        return self._to_canvas_data(self.doc)
    
    async def sync_with_peers(
        self, 
        peer_changes: bytes
    ) -> CanvasData:
        """与其他用户同步"""
        # Automerge 自动三向合并
        self.doc = Automerge.merge(self.doc, peer_changes)
        return self._to_canvas_data(self.doc)

# 基于 OT (Operational Transformation) 的备选方案
class OTCanvas:
    """基于 OT 的 Canvas 协作引擎"""
    
    def __init__(self):
        self.version = 0
        self.canvas_data: CanvasData = None
        self.pending_operations: List[Operation] = []
    
    async def apply_operation(
        self, 
        operation: Operation,
        base_version: int
    ) -> CanvasData:
        """应用操作（需要转换冲突操作）"""
        
        if base_version < self.version:
            # 有其他操作已经应用，需要转换当前操作
            operations_to_transform = [
                op for op in self.operations_log 
                if op.version > base_version
            ]
            
            transformed_op = self.transform_operation(
                operation,
                operations_to_transform
            )
        else:
            transformed_op = operation
        
        # 应用转换后的操作
        self.canvas_data = self.apply_to_canvas(
            self.canvas_data, 
            transformed_op
        )
        
        self.version += 1
        self.operations_log.append(transformed_op)
        
        return self.canvas_data
    
    def transform_operation(
        self, 
        op: Operation,
        against_ops: List[Operation]
    ) -> Operation:
        """操作转换（OT 核心算法）"""
        transformed = op
        
        for other_op in against_ops:
            transformed = self._transform_pair(transformed, other_op)
        
        return transformed
    
    def _transform_pair(self, op1: Operation, op2: Operation) -> Operation:
        """转换两个操作（简化版）"""
        if op1.type == OperationType.INSERT and op2.type == OperationType.INSERT:
            # 两个插入操作
            if op1.position <= op2.position:
                # op1 在前，op2 位置需要后移
                return Operation(
                    **op1.__dict__,
                    position=op1.position
                )
            else:
                # op2 在前，op1 位置需要后移
                return Operation(
                    **op1.__dict__,
                    position=op1.position + 1
                )
        
        # ... 更多转换规则
        return op1

# 智能冲突解决器
class ConflictResolver:
    """智能冲突解决"""
    
    async def resolve_conflict(
        self,
        local_change: NodeDiff,
        remote_change: NodeDiff,
        strategy: ConflictResolutionStrategy
    ) -> NodeDiff:
        """解决冲突"""
        
        if strategy == ConflictResolutionStrategy.LAST_WRITE_WINS:
            # 比较时间戳
            return (
                remote_change 
                if remote_change.timestamp > local_change.timestamp 
                else local_change
            )
        
        elif strategy == ConflictResolutionStrategy.MERGE:
            # 智能合并
            return await self.intelligent_merge(local_change, remote_change)
        
        elif strategy == ConflictResolutionStrategy.MANUAL:
            # 提交到冲突队列，等待人工解决
            await self.conflict_queue.add({
                'local': local_change,
                'remote': remote_change,
                'canvas_id': local_change.canvas_id
            })
            # 返回临时冲突标记
            return self.create_conflict_marker(local_change, remote_change)
    
    async def intelligent_merge(
        self,
        local: NodeDiff,
        remote: NodeDiff
    ) -> NodeDiff:
        """智能合并（使用 LLM）"""
        # 使用小模型判断冲突性质
        prompt = f"""
        Two users edited the same node simultaneously:
        
        User A's change: {local.to_dict()}
        User B's change: {remote.to_dict()}
        
        Suggest a merged version that preserves both users' intentions.
        """
        
        llm_suggestion = await self.llm.invoke(prompt)
        
        # 解析 LLM 建议并应用
        merged = self.parse_merge_suggestion(llm_suggestion)
        
        return merged
```

**协作能力对比：**

| 特性 | Refly | AgenticX (CRDT) | AgenticX (OT) |
|------|-------|----------------|---------------|
| 实时协作 | ❌ | ✅ | ✅ |
| 离线编辑 | ⚠️ 有限 | ✅ 完全支持 | ⚠️ 需要在线转换 |
| 冲突自动解决 | ❌ | ✅ | ✅ |
| 性能开销 | 低 | 中等 | 高 |
| 实现复杂度 | 低 | 高 | 很高 |

**AgenticX 实施建议：**
1. **MVP阶段**：使用 Refly 的事务式同步 + Last-Write-Wins
2. **多用户阶段**：引入 CRDT (Automerge/Yjs) 支持实时协作
3. **企业级**：实现完整的 OT + 人工冲突解决流程

---

## 工程化落地路线图

基于以上5个核心追问，AgenticX 的分阶段实施建议：

### Phase 1: 基础能力构建（0-3个月）
- ✅ 实现 Refly 风格的轮询调度器
- ✅ 基础上下文管理（元数据保留 + 懒加载）
- ✅ 工具系统基础抽象层
- ✅ 简单的超时检测

### Phase 2: 性能优化（3-6个月）
- 🔄 引入事件驱动调度（保留轮询兜底）
- 🔄 上下文压缩与摘要
- 🔄 工具协议适配器（MCP + LangChain）
- 🔄 节点重试机制

### Phase 3: 可靠性增强（6-12个月）
- 🔄 检查点系统 + 故障恢复
- 🔄 RAG-based 上下文检索
- 🔄 智能工具推荐
- 🔄 死信队列 + 人工介入

### Phase 4: 协作与扩展（12-18个月）
- 🔄 CRDT-based 实时协作
- 🔄 超大规模上下文支持（百万Token）
- 🔄 工具生态市场
- 🔄 完整的可观测性平台

---

**下一步行动：**
1. 选择1-2个追问进行 **原型验证**（建议从追问1和追问3开始）
2. 在 AgenticX 中实现 **最小可行方案**（MVP）
3. 收集真实场景数据，迭代优化

