# Portal 附件体验升级：上传进度、解析态、原件存储与原件预览

Planned-with: claude-opus-5-thinking
Suggested-Impl-Model: 见「推荐实施模型」表（按子阶段分派）

---

## 1. 背景与问题（证据链，勿依赖对话上下文）

Enterprise web-portal 的聊天附件链路当前只做「解析取文本」，**不保存原始文件**。由此产生三个可观察缺陷：

### 1.1 上传/解析全程只有一个静态文案

`enterprise/features/chat/src/types/composer-attachment.ts:1`

```ts
export type ComposerAttachmentStatus = "parsing" | "ready" | "error";
```

状态机只有三态，没有 `uploading`，也没有进度字段。渲染层 `enterprise/features/chat/src/components/atoms/AttachmentChip.tsx:30-36`：

```ts
function statusLabel(file: ComposerAttachment): string {
  if (file.status === "parsing") return "处理中…";
  ...
}
```

于是用户上传 15MB PDF 时，从「网络上传中」到「服务端解析中」全程只看到一句「处理中…」，无法判断是网络慢还是解析慢，也无法判断是否卡死。

### 1.2 输入区芯片不显示文件大小

`AttachmentChip.tsx:59-62` 只渲染 `file.name` + `statusLabel(file)`，没有 size。
而气泡里的卡片 `enterprise/features/chat/src/components/atoms/UserMessageAttachmentCard.tsx:29-37` 已有 `formatFileSize`，但精度是 `toFixed(1)`（`15.2 MB`），与业界主流产品的两位小数（`15.19 MB`）不一致，且两处实现重复。

### 1.3 原件从未落盘，历史会话无法预览原文档

`enterprise/apps/web-portal/src/app/api/chat/attachments/parse/route.ts:76-92`：

```ts
const buffer = Buffer.from(await file.arrayBuffer());
const parsed = await withTimeout(parseAttachmentFile({ ... }), PARSE_TIMEOUT_MS, file.name);
results.push({ name, mime_type, kind, parsed_text, size });
```

`buffer` 用完即弃，只返回 `parsed_text`。因此：

- 预览面板 `enterprise/features/chat/src/components/molecules/AttachmentContentPanel.tsx:125` 只能 `attachment?.parsed_text`，渲染纯 Markdown，丢失原版式、表格、图片、批注高亮。
- 该面板的「下载」按钮 `AttachmentContentPanel.tsx:181` 实际调用 `triggerTextDownload(body, ...)`，下载的是 `.md` 文本而非原文件——**这是当前的语义错误，用户点「下载」拿不到自己上传的 PDF**。
- 没有缩放能力（业界主流产品预览器有 ⊕/⊖）。
- 用户翻回很久以前的会话想看当初那份文档，只能看到解析文本，且该文本还被截断到 120k 字符（`enterprise/apps/web-portal/src/lib/attachment-parse-limits.ts:2`）。

### 1.4 附件解析失败是「全批次连坐」

`enterprise/features/chat/src/hooks/useComposerAttachments.ts:178-199`：所有文档合并成**一个** `POST /api/chat/attachments/parse` 请求，`catch` 里对 `docSlots` 全量打 error。一个文件解析失败会让同批其它文件全部失败。这也是无法做「单文件进度」的结构性原因。

### 1.5 相关既有约束（实施时必须遵守，勿踩坑）

- `enterprise/apps/web-portal/src/lib/attachment-parse-limits.ts`：`MAX_PARSE_FILE_BYTES = 100 * 1024 * 1024`，`MAX_PARSED_TEXT_CHARS = 120_000`。
- `enterprise/features/chat/src/types/composer-attachment.ts:18-20`：`MAX_ATTACHMENTS = 50`，`MAX_FILE_BYTES = 100MB`。
- `enterprise/features/chat/src/history-outbox.ts` 的 `stripToAppendPayload` 会剥离 `data_url`、截断 `parsed_text`，`MAX_JOB_BYTES = 1_000_000`。任何新增 attachment 字段若体积大，会撑爆离线队列预算。
- `enterprise/apps/web-portal/src/lib/chat-message-sanitize.ts:21-77` 的 `sanitizeAttachments` 是服务端唯一入口白名单：**未在此显式透传的字段会被静默丢弃**。新增 `attachment_id` 必须在此放行，否则历史落库拿不到引用。
- 企业栈目前**没有任何对象存储集成**（全仓检索无 S3/MinIO/OSS 客户端）。

---

## 2. 目标 / 非目标

### 2.1 目标（In scope）

- FR-1 上传阶段可见真实百分比进度。
- FR-2 上传完成到解析完成之间有独立的「等待解析」态。
- FR-3 解析完成后输入区芯片显示 `PDF 15.19 MB` 形态的类型+大小。
- FR-4 单文件失败不连坐同批其它文件。
- FR-5 原始文件落盘保存，与消息附件通过 `attachment_id` 关联。
- FR-6 预览面板支持**原件渲染**：PDF 按原版式逐页显示、支持缩放；图片原图显示、支持缩放。
- FR-7 预览面板「下载」下载**原文件**（当前错误地下载 .md，需修正）。
- FR-8 历史会话（含很久以前的会话）点开附件卡片仍可预览原件。
- FR-9 原件不可用时（超限未存 / 已过期 / Office 类无法原生渲染）优雅降级到现有 `parsed_text` Markdown 视图，并明确告知原因。

### 2.2 非目标（Out of scope，禁止顺手做）

- 不做 docx/xlsx/pptx 的浏览器端原版式渲染（无可靠纯前端方案；这类文件走「下载原件 + 解析文本预览」）。
- 不引入 MinIO/S3 等新基础设施容器（本期用可插拔驱动 + 文件系统默认实现，S3 驱动留接口不实现）。
- 不改动 `parsed_text` 的生成逻辑与截断上限。
- 不改动 Desktop 端（`desktop/`）任何代码。
- 不改动 admin-console。
- 不做附件全文检索。
- 不重构 `useComposerAttachments` 中与图片压缩相关的既有逻辑（`compressImageForChat` 分支保持原样）。

---

## 3. 架构决策：原件存到哪

### 3.1 选项对比

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| A. PG `bytea` / MySQL `longblob` 直存 | 无新组件，随库备份 | 100MB 二进制入库导致 WAL 膨胀、备份暴涨、TOAST 读放大；MySQL `max_allowed_packet` 需调 | 否 |
| B. 文件系统卷 + DB 元数据行 | 无新基础设施；与既有 `.runtime/` 落盘惯例一致；大文件天然适配 | 多副本 portal 需共享卷 | **采用（默认驱动）** |
| C. S3/MinIO | 水平扩展最佳 | 引入新容器与凭据体系，超出本期范围 | 留驱动接口，本期不实现 |

### 3.2 决策

采用 **B**，并按 `enterprise/apps/web-portal/src/lib/deep-research/artifact-store.ts` 既有的「驱动可插拔」模式实现：

- 元数据（含 `storage_driver`、`storage_key`）入库，新表 `enterprise_chat_attachments`。
- 二进制落 `ATTACHMENT_BLOB_DIR`（默认 `enterprise/.runtime/attachments`）。
- 表内保留 `storage_driver` 列，后续加 S3 驱动**无需再迁移**。

### 3.3 原件保留上限

新增 `MAX_ORIGINAL_RETAIN_BYTES = 50 * 1024 * 1024`（可用环境变量 `ATTACHMENT_MAX_RETAIN_BYTES` 覆盖）。

- 文件 ≤ 50MB：存原件，可原件预览。
- 文件 > 50MB 但 ≤ `MAX_PARSE_FILE_BYTES`(100MB)：**仍正常解析问答**，但不存原件，预览降级为解析文本，UI 明示「文件超过 50MB，未保留原件，仅可预览解析文本」。

理由：解析上限 100MB 是问答能力边界，不应因存储策略收窄；但 100MB 原件全量长期保留成本过高。两者解耦。

---

## 4. 阶段划分与推荐实施模型

| 阶段 | 内容 | 推荐模型 | 理由 |
|---|---|---|---|
| P1 | 前端上传进度 / 解析态 / 大小显示 / 失败隔离 | `composer-2.5-fast` | 纯前端状态机与样式，改动面清晰，无需强推理 |
| P2 | 数据模型 + 迁移 + 原件存储服务 + 取件 API | `gpt-5.6-terra-medium` | 后端接线 + 迁移编号契约敏感，需稳健但非顶配 |
| P3 | 预览面板原件渲染（PDF viewer + 缩放 + 下载原件） | `claude-opus-5-thinking-medium` | 涉及视觉品味与交互手感，且 pdfjs 集成有 SSR/worker 坑 |
| P4 | 端到端串联 + 历史会话回归 + GC | `gpt-5.6-luna-medium` | 跨栈收口，需一致性推理 |

P1 与 P2 无依赖，可并行。P3 依赖 P2。P4 最后。

---

## 5. P1：上传进度、解析态、文件大小、失败隔离

### FR-1.1 扩展附件状态机

**文件**：`enterprise/features/chat/src/types/composer-attachment.ts:1-15`

before：

```ts
export type ComposerAttachmentStatus = "parsing" | "ready" | "error";

export type ComposerAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  status: ComposerAttachmentStatus;
  kind?: ComposerAttachmentKind;
  dataUrl?: string;
  parsedText?: string;
  errorText?: string;
};
```

after：

```ts
export type ComposerAttachmentStatus = "uploading" | "parsing" | "ready" | "error";

export type ComposerAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  status: ComposerAttachmentStatus;
  kind?: ComposerAttachmentKind;
  dataUrl?: string;
  parsedText?: string;
  errorText?: string;
  /** 0-100，仅 status === "uploading" 时有意义 */
  uploadProgress?: number;
  /** P2 落地后由 parse 接口回填；无原件时为空 */
  attachmentId?: string;
};
```

保留 `"parsing"` 字面量不改名，避免影响其它引用点。

### FR-1.2 逐文件上传 + 真实进度

**文件**：`enterprise/features/chat/src/hooks/useComposerAttachments.ts:14-52`（`parseRemoteFiles`）

`fetch` 无法读取上传进度，必须换 `XMLHttpRequest`。将批量函数改为单文件函数：

```ts
type ParsedRow = {
  name: string;
  mime_type: string;
  kind: "document" | "video";
  parsed_text: string;
  size: number;
  attachment_id?: string; // P2 之后由服务端返回
};

function parseRemoteFile(
  file: File,
  onProgress: (percent: number) => void,
): Promise<ParsedRow> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/chat/attachments/parse");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => {
      // 2xx 解 data.attachments[0]；非 2xx 解 error.message，reject(new Error(message))
    };
    xhr.onerror = () => reject(new Error("网络错误，文件上传失败"));
    xhr.ontimeout = () => reject(new Error("上传超时"));
    const body = new FormData();
    body.append("files", file);
    xhr.send(body);
  });
}
```

要点：
- `xhr.upload.onprogress` 到 100% 表示**字节送达服务端**，此时服务端才开始解析，因此进度封顶 99，随后由调用方切 `status: "parsing"`。
- 错误消息解析规则与原 `fetch` 版一致：优先取 JSON 的 `error.message`，回落 `xhr.statusText`，再回落 `"文件解析失败"`。

**调用侧**：`useComposerAttachments.ts:146-199`

- 建槽时 `status: "uploading", uploadProgress: 0`（原为 `status: "parsing"`）。
- 每个 `docSlot` 独立 `await`/并发调用 `parseRemoteFile`，**各自 try/catch**，替换现有的「一个 try 包住整批」结构（原 `:177-199`）。
- `onProgress` 回调里 `patchAttachment(slot.id, { uploadProgress: percent })`。
- 上传完成、等待响应期间：`patchAttachment(slot.id, { status: "parsing", uploadProgress: 100 })`。
- 成功：`patchAttachment(slot.id, { status: "ready", mimeType, kind, parsedText, attachmentId })`。
- 失败：**只**对该 slot 打 error，不再对其它 slot 打 error；`setError` 仅在全部失败时设置，避免单个失败弹全局错误。
- 并发上限 3，避免 50 个文件同时打满连接。

图片分支（`:159-173`）保持不变，但建槽状态同样改为 `"uploading"`，压缩前后分别 patch，压缩属本地计算，进度可直接从 0 跳 100。

### FR-1.3 芯片渲染进度、等待解析、类型+大小

**文件**：`enterprise/features/chat/src/components/atoms/AttachmentChip.tsx:30-36, 59-62`

`statusLabel` 改为：

```ts
function statusLabel(file: ComposerAttachment): string {
  if (file.status === "uploading") return `${file.uploadProgress ?? 0}%`;
  if (file.status === "parsing") return "等待解析";
  if (file.status === "error") return file.errorText ?? "失败";
  if (file.kind === "video") return "视频（仅文件名）";
  return [kindBadge(file), formatFileSize(file.size)].filter(Boolean).join(" ");
}
```

即 ready 态显示 `PDF 15.19 MB`，替换原来的「文档已解析 / 已就绪」文案。

视觉：
- `uploading` / `parsing` 态在文件名下方那一行左侧加一个 `h-3.5 w-3.5` 的旋转 spinner（`animate-spin` + `border-2 border-current border-t-transparent rounded-full`），与文案同排，对应主流产品的转圈 + 百分比。
- 颜色沿用 `text-xs text-muted-foreground`，不引入新色值，不硬编码十六进制。

### FR-1.4 抽出统一的 size 格式化

**新建**：`enterprise/features/chat/src/utils/format-file-size.ts`

```ts
export function formatFileSize(size?: number): string {
  if (size == null || !Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}
```

`UserMessageAttachmentCard.tsx:29-37` 的本地 `formatFileSize` 删除，改为 import 该工具（`AttachmentChip.tsx` 同样 import）。注意精度从 `toFixed(1)` 变为 `toFixed(2)`：`15.19 MB`。

### P1 验收标准

- AC-1.1 `pnpm -C enterprise --filter @agenticx/chat test` 全绿。
- AC-1.2 新增 `enterprise/features/chat/src/utils/__tests__/format-file-size.test.ts`：断言 `formatFileSize(15_925_248) === "15.19 MB"`、`formatFileSize(0) === ""`、`formatFileSize(512) === "512 B"`、`formatFileSize(2048) === "2.00 KB"`。
- AC-1.3 新增 `enterprise/features/chat/src/components/atoms/__tests__/AttachmentChip.test.tsx`：
  - `status: "uploading", uploadProgress: 23` → 渲染出文本 `23%`；
  - `status: "parsing"` → 渲染出 `等待解析`；
  - `status: "ready", kind: "document", name: "a.pdf", size: 15_925_248` → 渲染出 `PDF 15.19 MB`。
- AC-1.4 手动：上传一个 ≥10MB PDF，芯片百分比从 0 递增到 99，随后变「等待解析」，最后变 `PDF x.xx MB`。
- AC-1.5 手动：同时选 2 个文件，其中 1 个是损坏的 PDF，损坏那个显示错误，另一个仍能正常 ready。

---

## 6. P2：原件存储与取件 API

### FR-2.1 新增数据表

**新建**：`enterprise/packages/db-schema/src/schema/chat-attachments.ts`

参照 `enterprise/packages/db-schema/src/schema/chat-artifacts.ts` 的写法：

```ts
import { bigint, index, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const enterpriseChatAttachments = pgTable(
  "enterprise_chat_attachments",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    /** 上传时尚无 sessionId，落库后由消息落盘时回填；允许为空 */
    sessionId: varchar("session_id", { length: 26 }),
    fileName: text("file_name").notNull(),
    mimeType: varchar("mime_type", { length: 128 }).notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    kind: varchar("kind", { length: 32 }).default("document").notNull(),
    /** "fs" | "s3"（本期仅实现 fs） */
    storageDriver: varchar("storage_driver", { length: 16 }).default("fs").notNull(),
    /** fs 驱动下为相对 blob 根目录的路径 */
    storageKey: text("storage_key").notNull(),
    /** sha256 十六进制，用于去重与完整性校验 */
    checksum: varchar("checksum", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => ({
    ownerIdx: index("enterprise_chat_attachments_owner_idx").on(
      table.tenantId,
      table.userId,
      table.createdAt,
    ),
    sessionIdx: index("enterprise_chat_attachments_session_idx").on(
      table.tenantId,
      table.sessionId,
    ),
  }),
);
```

**同时新建** MySQL 对偶：`enterprise/packages/db-schema/src/mysql-schema/chat-attachments.ts`，列名与逻辑类型必须与 PG 一致（`src/__tests__/schema-parity.test.ts` 会强制校验）。参照同目录 `chat-artifacts.ts`。

**导出**：在 `enterprise/packages/db-schema/src/schema/index.ts` 与 `src/mysql-schema/index.ts` 各加一行 `export * from "./chat-attachments";`（现有第 15 行是 `export * from "./chat-artifacts";`，紧随其后即可）。

### FR-2.2 迁移文件与 journal（易踩坑，务必照做）

1. 新建 `enterprise/packages/db-schema/drizzle/0039_enterprise_chat_attachments.sql`，内容为 `CREATE TABLE IF NOT EXISTS enterprise_chat_attachments (...)` 加两个索引。
2. 在 `enterprise/packages/db-schema/drizzle/meta/_journal.json` 追加一条 `{ "idx": 36, "tag": "0039_enterprise_chat_attachments", ... }`（`idx` 连续，紧接当前最大值）。
3. **必须同步修改** `enterprise/packages/db-schema/src/__tests__/migration-inventory.test.ts`：
   - `:16` 与 `:22-23` 的 `36` 改为 `37`（`toHaveLength(37)`、`[...Array(37).keys()]`，标题文案同步）。
   - `:26` 与 `:30` 的 `38` 改为 `39`。
   - `KNOWN_ORPHANS` 保持不变。
4. MySQL 侧把建表语句补进 `enterprise/packages/db-schema/drizzle-mysql/0000_mysql_baseline.sql`（该链路是单文件 baseline，非增量）。

漏掉第 3 步会导致 `migration-inventory.test.ts` 直接红。

### FR-2.3 原件存储服务

**新建**：`enterprise/apps/web-portal/src/lib/attachments/original-store.ts`

对齐 `enterprise/apps/web-portal/src/lib/deep-research/artifact-store.ts` 的结构（driver 选择 + PG/MySQL 分支 + 导出 `defaultXxxStore` 单例）。

```ts
export const MAX_ORIGINAL_RETAIN_BYTES = Number(process.env.ATTACHMENT_MAX_RETAIN_BYTES ?? 50 * 1024 * 1024);
/** 未被任何消息引用的孤儿附件保留时长 */
export const ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;

export type AttachmentRecord = {
  id: string; tenantId: string; userId: string; sessionId: string | null;
  fileName: string; mimeType: string; byteSize: number; kind: string;
  storageDriver: "fs" | "s3"; storageKey: string; checksum: string;
  createdAt: string; expiresAt: string | null;
};

export type OriginalStore = {
  put(input: { tenantId: string; userId: string; fileName: string; mimeType: string; kind: string; buffer: Buffer }): Promise<AttachmentRecord>;
  getMeta(tenantId: string, userId: string, id: string): Promise<AttachmentRecord | null>;
  openStream(record: AttachmentRecord): Promise<NodeJS.ReadableStream>;
  bindSession(tenantId: string, ids: string[], sessionId: string): Promise<void>;
  deleteBySession(tenantId: string, sessionId: string): Promise<void>;
  purgeExpiredOrphans(): Promise<number>;
};
```

fs 驱动落盘路径：`<ATTACHMENT_BLOB_DIR>/<tenantId>/<YYYYMM>/<ulid>`，`ATTACHMENT_BLOB_DIR` 默认 `enterprise/.runtime/attachments`。

安全硬要求：
- `storageKey` 由服务端自行拼装，**绝不接受客户端传入路径**。
- 读取前 `path.resolve` 后校验仍在 blob 根目录内（防目录穿越）。
- 写入用 `写临时文件 + rename` 保证原子性。

### FR-2.4 parse 接口顺带存原件

**文件**：`enterprise/apps/web-portal/src/app/api/chat/attachments/parse/route.ts:75-92`

在现有 `buffer` 可用处（`:76`）追加：`file.size <= MAX_ORIGINAL_RETAIN_BYTES` 时调用 `defaultOriginalStore.put(...)`，把返回的 `id` 放进响应行的 `attachment_id`。

关键约束：
- 存原件失败**不得**让整个解析请求失败。用 try/catch 包住 put，失败仅 `console.warn` 并让 `attachment_id` 缺省，解析结果照常返回。原件预览是增强能力，不能拖垮问答主链路。
- 响应结构从 `{ name, mime_type, kind, parsed_text, size }` 增加可选 `attachment_id`，其余字段不变（向后兼容旧前端）。

### FR-2.5 取件 API

**新建**：`enterprise/apps/web-portal/src/app/api/chat/attachments/[id]/route.ts`

严格参照 `enterprise/apps/web-portal/src/app/api/chat/artifacts/[id]/route.ts` 的鉴权写法：`getSessionFromCookies()` → 401 → 取 `id` → `getMeta(session.tenantId, session.userId, id)` → 404。

差异点：
- 返回二进制流而非 JSON。
- 响应头：`Content-Type: <mimeType>`、`Content-Length`、`Content-Disposition`（`inline` 用于预览，`?download=1` 时 `attachment`，文件名用 `filename*=UTF-8''<encodeURIComponent(name)>` 以支持中文名）。
- 加 `Cache-Control: private, max-age=3600`。
- **必须**加 `X-Content-Type-Options: nosniff`；对 `text/html`、`image/svg+xml` 等可执行脚本的类型，强制以 `application/octet-stream` + `attachment` 下发，防存储型 XSS。
- 支持 `Range` 请求（PDF viewer 会按范围拉取，缺了会全量下载导致大文件预览很慢）。

### FR-2.6 attachment_id 贯通到落库与历史

三处必须同步改，缺一则历史会话拿不到原件：

1. `enterprise/packages/core-api/src/chat.ts` 的 `ChatMessageAttachment` 增加 `attachment_id?: string;`。
2. `enterprise/apps/web-portal/src/lib/chat-message-sanitize.ts` 的 `sanitizeAttachments`（`:29-74`）：解析 `row.attachment_id`，用文件顶部已有的 `ULID_RE`（`:10`）校验格式，非法则丢弃而非抛错（避免旧客户端脏数据打挂整条消息），合法则并入 `out.push({...})` 的展开对象，写法与 `:72-73` 的 `...(dataUrl ? ... : {})` 一致。
3. `enterprise/features/chat/src/history-outbox.ts` 的 `stripToAppendPayload`：`HistoryAppendAttachmentMeta` 增加 `attachment_id?: string` 并透传。26 字符对 `MAX_JOB_BYTES` 无实质影响。**注意**：该函数内已有「预算超限时二次剥离」的兜底逻辑，二次剥离时**必须保留** `attachment_id`（它正是丢掉 `parsed_text` 之后唯一的预览退路）。
4. `useComposerAttachments.ts` 的 `toMessageAttachments`（`:205-214`）把 `attachmentId` 映射成 `attachment_id`。

### FR-2.7 生命周期

- 会话删除时级联删附件：接入 `enterprise/apps/web-portal/src/app/api/chat/sessions/batch-delete` 与单会话删除路径，调用 `deleteBySession`。
- 孤儿清理：用户选了文件但从未发送 → 无 `sessionId`，超过 `ORPHAN_TTL_MS` 由 `purgeExpiredOrphans()` 清理。本期以「取件 API 冷路径触发 + 可手工调用的脚本」实现即可，不引入定时任务框架。

### P2 验收标准

- AC-2.1 `pnpm -C enterprise --filter @agenticx/db-schema test` 全绿（含 `migration-inventory` 与 `schema-parity`）。
- AC-2.2 新增 `enterprise/apps/web-portal/src/lib/attachments/__tests__/original-store.test.ts`：put→getMeta→openStream 往返一致；checksum 与源 buffer 的 sha256 相等；构造 `storageKey = "../../etc/passwd"` 的记录时 `openStream` 抛错。
- AC-2.3 新增 `chat-message-sanitize.test.ts` 用例：合法 ULID 的 `attachment_id` 被保留；`"not-a-ulid"` 被丢弃且不抛错。
- AC-2.4 新增 `history-outbox.test.ts` 用例：payload 超 `MAX_JOB_BYTES` 触发二次剥离后，`parsed_text` 消失但 `attachment_id` 仍在。
- AC-2.5 手动：起 `bash enterprise/scripts/start-dev-with-infra.sh`，上传 PDF，`psql` 查 `select id, file_name, byte_size, storage_key from enterprise_chat_attachments;` 有行；`enterprise/.runtime/attachments/` 下有对应文件。
- AC-2.6 手动：用 A 用户的 cookie 请求 B 用户的 `attachment_id`，返回 404 而非文件。

---

## 7. P3：原件预览

### FR-3.1 面板改造

**文件**：`enterprise/features/chat/src/components/molecules/AttachmentContentPanel.tsx`

现状是「只渲染 `parsed_text` 的 Markdown」（`:125`、`:217-225`）。改为按能力分流：

| 条件 | 渲染 |
|---|---|
| 有 `attachment_id` 且 mime 为 `application/pdf` | PDF 原件逐页渲染 + 缩放 |
| 有 `attachment_id` 且 mime 为 `image/*` | 原图 + 缩放 |
| 其余（Office / 无原件 / 原件过期） | 现有 `parsed_text` Markdown（保持不变） |

工具栏在现有全屏/下载/关闭（`:158-206`）之外，插入 ⊖ / ⊕ 两个缩放按钮，仅在原件渲染模式下显示。缩放步长 10%，范围 50%–300%。

### FR-3.2 修正下载语义

`AttachmentContentPanel.tsx:181` 当前是 `triggerTextDownload(body, ...)`，下载 `.md`。改为：

- 有 `attachment_id`：跳 `/api/chat/attachments/<id>?download=1`，下载原文件。
- 无 `attachment_id`：保留现有 `.md` 文本下载，按钮 tooltip 改为「下载解析文本」以免误导。

### FR-3.3 PDF 渲染实现要点

用 `pdfjs-dist`。Next.js App Router 下的已知坑，必须处理：

- 组件必须 `"use client"`，且用 `next/dynamic` 配 `ssr: false` 引入，否则构建期 `DOMMatrix is not defined`。
- worker 需显式设置 `GlobalWorkerOptions.workerSrc`；不要依赖 CDN（客户内网可能无外网），把 worker 文件通过 `next.config` 的静态资源或 `public/` 自托管。
- 用 `getDocument({ url, withCredentials: true })` 让 pdfjs 带 cookie 访问取件 API（FR-2.5 已支持 Range）。
- 组件卸载时 `pdf.destroy()`，避免切换附件泄漏 worker。
- 加载中显示骨架，失败降级到 `parsed_text` 视图并提示。

### FR-3.4 历史会话可预览

`UserMessageAttachmentCard.tsx:52` 当前：

```ts
const canPreview = Boolean(attachment.parsed_text?.trim() && onPreview);
```

改为 `Boolean((attachment.attachment_id || attachment.parsed_text?.trim()) && onPreview)`——只要有原件引用，即便 `parsed_text` 因离线队列预算被剥离，也应可预览。

### P3 验收标准

- AC-3.1 `pnpm -C enterprise --filter @agenticx/chat test` 与 `pnpm -C enterprise build` 均绿（重点看 PDF 组件不破 SSR 构建）。
- AC-3.2 手动：上传 PDF 发送 → 点气泡下方卡片 → 右侧面板显示 PDF 原版式，⊕/⊖ 生效，滚动可翻页。
- AC-3.3 手动：点下载，得到的是原 PDF（文件名与大小与上传一致），不是 `.md`。
- AC-3.4 手动：刷新页面、切走再切回该会话，预览仍可用。
- AC-3.5 手动：上传 `.docx` → 面板回落 Markdown 视图，下载按钮给原 docx。
- AC-3.6 手动：上传 60MB PDF → 正常问答，面板提示未保留原件，仅解析文本。

---

## 8. P4：端到端收口

- AC-4.1 三态主题（light/dim/dark）下芯片、面板、缩放按钮均无对比度问题，不得硬编码颜色，统一走 `@agenticx/ui` 语义 token。
- AC-4.2 `pnpm -C enterprise typecheck && pnpm -C enterprise build` 全绿。
- AC-4.3 `bash enterprise/scripts/e2e-visual-tour.ts` 对应页面截图无回归。
- AC-4.4 删除会话后，`enterprise_chat_attachments` 对应行与 blob 文件均已清除。
- AC-4.5 断网重连场景：离线期间发送带附件消息，恢复后历史同步成功，且刷新后仍可预览原件。

---

## 9. 风险与回滚

| 风险 | 缓解 |
|---|---|
| blob 目录随时间膨胀 | `MAX_ORIGINAL_RETAIN_BYTES` 上限 + 会话删除级联 + 孤儿 TTL；部署文档标注该目录需纳入容量监控 |
| 多副本 portal 无共享卷导致取件 404 | 部署文档明确：多副本必须挂共享卷，否则设 `ATTACHMENT_MAX_RETAIN_BYTES=0` 关闭原件保留 |
| pdfjs 体积增加首屏包 | 走 `next/dynamic` 懒加载，仅打开预览时才拉 |
| 存储型 XSS | FR-2.5 的 `nosniff` + 危险 mime 强制 `attachment` 下发 |
| 迁移编号契约被漏改 | FR-2.2 第 3 步已显式列出 `migration-inventory.test.ts` 的具体行号与数值 |

回滚：设 `ATTACHMENT_MAX_RETAIN_BYTES=0` 即可让所有新上传不存原件，前端自动全量降级到解析文本视图，P1 的进度/大小改进不受影响。数据表可保留不删。

---

## 10. 实施顺序建议

1. P1 独立成 commit（纯前端，可先行交付验证手感）。
2. P2 独立成 commit（含迁移，需 DB 环境验证）。
3. P3 独立成 commit。
4. P4 收口 commit。

每个 commit 前须跑对应 AC 中的自动化命令，绿了再进下一段。
