/**
 * Gateway `/api/mobile/*` 契约类型（与 SP-M2 对齐）。
 *
 * 会话/消息字段在后端仍在演进，按弱类型声明 + index signature 兜底，
 * 多余字段不报错、不丢失。
 */

export interface BindRequest {
  connect_session_id: string;
  install_id: string;
}

export interface BindResponse {
  device_id: string;
  mobile_token: string;
  /** SP-M2 后端当前固定返回 null（config 暂无设备名字段），UI 需兜底 */
  desktop_name: string | null;
}

export interface MobileStatus {
  online: boolean;
  device_id: string;
  /** 同 BindResponse：后端可能为 null */
  desktop_name: string | null;
}

export interface MobileSession {
  id: string;
  title: string;
  /** 归一化后的毫秒时间戳 */
  updated_at: number;
  running?: boolean;
  /** studio sessions.list 透传：模型/供应商（老数据缺省 → 不展示） */
  model?: string;
  provider?: string;
  session_mode?: string;
  [key: string]: unknown;
}

export interface MobileMessage {
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  ts?: number;
  /** batch2：tool 消息结构化字段（老消息缺省 → 纯文本回退） */
  tool_call_id?: string;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  tool_status?: "done" | "error" | string;
  /** batch2：assistant 思考过程 */
  reasoning?: string;
  [key: string]: unknown;
}

export interface PendingConfirm {
  request_id: string;
  question: string;
}

/** 随消息一起发出的图片（studio 期望 data URL 形式的 image_inputs） */
export interface SendImageInput {
  name: string;
  data_url: string;
  mime_type: string;
  size: number;
}

export interface SendRequest {
  text: string;
  sender_name?: string;
  image_inputs?: SendImageInput[];
  /** 本轮注入的技能 slug（studio 注入到会话上下文） */
  skill_slugs?: string[];
  /** 本轮附带的飞书文档（桌面端经连接器拉正文后注入 context_files） */
  doc_refs?: SendDocRef[];
}

export interface SendResponse {
  reply: string;
  progress: string[];
  pending_confirm: PendingConfirm | null;
}

/** 「添加到对话 → 技能」列表项 */
export interface MobileSkill {
  name: string;
  description: string;
  source: string;
}

export interface SkillsResponse {
  skills: MobileSkill[];
}

/** 「添加到对话 → 飞书文档」列表项（桌面端连接器搜索结果） */
export interface MobileDoc {
  token: string;
  title: string;
  entity_type: string;
  doc_types?: string;
  url?: string;
  owner_name?: string;
  update_time_iso?: string;
}

export interface DocsResponse {
  docs: MobileDoc[];
}

/** 随消息下发的文档引用（桌面端据 token 拉取正文） */
export interface SendDocRef {
  token: string;
  title: string;
}

/** 会话上下文/Token 用量（studio context_usage 估算 + provider 实测累计） */
export interface SessionContextUsage {
  model?: string;
  used_tokens: number;
  max_tokens: number;
  percent: number;
  categories?: Record<string, number>;
  cache?: {
    session_input_tokens?: number;
    session_output_tokens?: number;
    session_total_tokens?: number;
    requests?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface MobileConfirm {
  request_id: string;
  agent_id: string;
  session_id: string;
  question: string;
  created_at: string | number;
  [key: string]: unknown;
}

export interface ConfirmDecision {
  approved: boolean;
  reason?: string;
}

export interface ConfirmResponse {
  ok: boolean;
  message: string;
}

export interface SessionsResponse {
  sessions: MobileSession[];
}

export interface MessagesResponse {
  messages: MobileMessage[];
}

export interface ConfirmsResponse {
  confirms: MobileConfirm[];
}

export interface UnbindResponse {
  ok: boolean;
}

export interface CreateSessionResponse {
  ok: boolean;
  session_id: string;
  session_name: string | null;
  [key: string]: unknown;
}

/** provider 配置条目（studio /api/config/providers 透传，弱类型兜底） */
export interface ProviderCatalogEntry {
  displayName?: string;
  /** 桌面端配置里的下划线写法（display_name） */
  display_name?: string;
  enabled?: boolean;
  /** 可见模型短名列表 */
  models?: string[];
  /** 单模型厂商的 legacy 字段 */
  model?: string;
  [key: string]: unknown;
}

/** 模型清单 + 当前活动模型（手机端模型选择器） */
export interface ModelsResponse {
  ok?: boolean;
  providers: Record<string, ProviderCatalogEntry>;
  defaultProvider?: string;
  activeProvider?: string;
  activeModel?: string;
  [key: string]: unknown;
}

/** 候选工作目录（手机端「当前活跃项目」选择器） */
export interface MobileWorkspace {
  name: string;
  path: string;
}

export interface WorkspacesResponse {
  workspaces: MobileWorkspace[];
}

export interface ToolRegistryItem {
  name: string;
  description: string;
  category: string;
  is_meta: boolean;
  [key: string]: unknown;
}

export interface McpServerInfo {
  name: string;
  connected: boolean;
  connection_state: string;
  tool_count: number;
  [key: string]: unknown;
}

export interface ToolsResponse {
  tools: ToolRegistryItem[];
}

export interface McpServersResponse {
  servers: McpServerInfo[];
}
