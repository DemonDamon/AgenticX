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

export interface SendRequest {
  text: string;
  sender_name?: string;
}

export interface SendResponse {
  reply: string;
  progress: string[];
  pending_confirm: PendingConfirm | null;
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
