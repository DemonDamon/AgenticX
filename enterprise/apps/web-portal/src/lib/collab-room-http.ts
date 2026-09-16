import type { AuthContext } from "@agenticx/auth";
import {
  chatHistoryBadRequest,
  chatHistoryForbidden,
  chatHistoryNotFound,
  chatHistoryServerError,
  chatHistoryUnauthorized,
} from "./chat-history-http";
import {
  CollabRoomBadRequestError,
  CollabRoomForbiddenError,
  CollabRoomNotFoundError,
  type CollabRoomContext,
} from "./collab-room";

export function toCollabRoomContext(session: AuthContext): CollabRoomContext {
  return { tenantId: session.tenantId, userId: session.userId };
}

export { chatHistoryUnauthorized as collabRoomUnauthorized };
export { chatHistoryBadRequest as collabRoomBadRequest };

/** 把 store 领域错误映射为 portal 既有的 HTTP 响应形状。 */
export function collabRoomErrorResponse(error: unknown) {
  if (error instanceof CollabRoomForbiddenError) return chatHistoryForbidden();
  if (error instanceof CollabRoomNotFoundError) return chatHistoryNotFound();
  if (error instanceof CollabRoomBadRequestError) return chatHistoryBadRequest(error.message);
  return chatHistoryServerError(error);
}

export function senderDisplayName(session: AuthContext): string {
  return session.email?.trim() || session.userId;
}
