# SP-B1：文件接入与解析流水线

> 需求映射：需求书 3.1.1 多渠道文件接入与预处理（12 需求点 #1）
> 人天：35（后端 18 / 算法 5 / 前端 8 / 测试 4）
> 前置：无（项目首个启动的工作流）
> 里程碑：M1（W3）流水线跑通

## 1. 目标

投标文件统一归集、预处理、解析调度：支持 PDF/Word/Excel/PPT/扫描件/图片/ZIP/RAR/CA 加密 PDF，单文件 2GB、2000 页，单批 500 份，断点续传续跑，自动关联供应商，任务排队与优先级调度。

## 2. 复用盘点

| 能力 | 位置 | 说明 |
|------|------|------|
| MinerU 解析 | `agenticx/tools/mineru.py` | 本地/远程 API/MCP 三模式；批量参数模型（文件列表/输出目录/并发数/回调 URL+secret，L150-L178）；回调签名验证（L181-L204）；远程任务轮询拉取（L207-L260）；OCR 语言、公式/表格识别、密码 PDF |
| 长任务编排 | `agenticx/longrun/orchestrator.py`、`retry_policy.py`、`stall_detector.py` | 重试、停滞检测 |
| 副作用账本 | `agenticx/reliability/call_ledger.py`、`replay_policy.py` | 批量任务崩溃恢复后不重复外部调用 |
| 任务工作区 | `agenticx/longrun/task_workspace.py`、`task_hooks.py` | 任务级状态与钩子 |
| 前端底座 | `enterprise/apps/web-portal/src/` 设计体系 | 上传组件、表格、进度条 |

## 3. 增量设计

### 3.1 数据模型（`agenticx/bidding/intake/models.py`）

```python
class BidProject(BaseModel):          # 采购项目
    id: str; name: str; code: str; status: ProjectStatus

class BidPackage(BaseModel):          # 投标文件包（一家供应商一次投标）
    id: str; project_id: str; supplier_id: str | None  # 解压/识别后回填
    source: Literal["upload", "procurement_sync"]
    priority: int = 0                 # 任务优先级

class BidFile(BaseModel):             # 单文件
    id: str; package_id: str; path: str; size_bytes: int
    fmt: Literal["pdf","docx","xlsx","pptx","image","zip","rar","boq","ca_pdf"]
    integrity: Literal["ok","corrupted","encrypted","unreadable"]
    sha256: str; version: int         # 唯一标识+版本号，全程追溯

class ParseTask(BaseModel):           # 解析任务
    id: str; file_id: str; status: TaskStatus
    # TaskStatus: queued → preprocessing → parsing → enriching → done | failed | suspended
    progress: float; pages: int; error: str | None
    checkpoint: dict                  # 断点：已处理页区间/已产出 artifact
```

### 3.2 接入流水线（`agenticx/bidding/intake/pipeline.py`）

```
上传/同步 → 完整性校验 → 格式识别 → 预处理 → MinerU 解析 → artifact 归档
```

- **压缩包归集**：ZIP/RAR 解压后按「文件夹名 / 文件名模式 / 招标文件响应表」三策略匹配供应商（`supplier_matcher.py`），无法唯一匹配的挂人工指派任务（action_proposals）。
- **预处理**：图片去噪/旋转矫正/清晰度增强（扫描件，算法侧）；损坏、加密、不可读文件标记 `integrity` 异常并告警，不阻塞同批其他文件。
- **超大文件**：>500MB 或 >500 页的文件走「后台临时处理」通道——分卷上传 + 分页分片解析 + checkpoint 记录页区间，中断后从 checkpoint 续跑。
- **CA 签章 PDF / 工程量清单**：新增 `ca_pdf.py`（签章容器解包 + 内容流提取）与 `boq.py`（工程量清单结构识别，独立于 MinerU 主链路）。
- **调度**：`agenticx/bidding/intake/scheduler.py`，基于 longrun orchestrator 实现队列 + 优先级（催办项目插队）+ 并发上限（与 GPU 数联动）。

### 3.3 对外接口（挂 `agenticx/server/`，经 Gateway BFF）

```
POST /api/bidding/projects/{id}/packages        # 创建文件包（上传/同步）
POST /api/bidding/packages/{id}/files:batch     # 批量上传（断点续传）
GET  /api/bidding/tasks?project_id=&status=     # 任务列表与进度
POST /api/bidding/tasks/{id}:resume             # 断点续跑
GET  /api/bidding/tasks/{id}/artifacts          # 解析产物（markdown/结构化 JSON）
```

### 3.4 前端页面（`enterprise/features/bidding/src/`）

- 文件归集页：拖拽批量上传、进度总览、失败重试、供应商指派
- 任务监控页：队列状态、优先级调整、断点续跑按钮

## 4. 任务分解

| 任务 | 岗位 | 人天 |
|------|------|------|
| 数据模型 + pipeline 骨架 + 调度器 | 后端 | 10 |
| CA 签章 PDF 解包、工程量清单解析 | 后端 | 6 |
| 压缩包供应商匹配规则 | 后端 | 2 |
| 扫描件预处理（去噪/矫正/增强） | 算法 | 5 |
| 上传/任务监控两个页面 | 前端 | 8 |
| 2GB/2000 页/500 份批量用例 + 断点续跑用例 | 测试 | 4 |
| **合计** | | **35** |

## 5. 验收标准

- 100 页可编辑 PDF 全量解析 ≤5 分钟；100 页扫描件（含 OCR）≤10 分钟（约定 GPU 算力前提）
- 500 份批量总耗时 ≤30 分钟，支持排队与优先级
- 上传/解析中断后可恢复，无需重新操作（断点续传续跑）
- 损坏/加密文件标记异常且不影响整批任务
- 单文件 2GB、2000 页跑通

## 6. 依赖与风险

- 依赖：MinerU 引擎部署（本地 GPU 或远程服务），W1 需定算力方案
- 风险：CA 签章 PDF 各家 CA 格式不一，先支持招标文件指定 CA 类型，其余类型列入兜底人工通道
