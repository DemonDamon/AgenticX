package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/openai"
)

// incident_action_handlers.go 安全事件一键处置端点（SP5 incident-response-loop）：
// admin-console 处置编排经 GATEWAY_INTERNAL_TOKEN 调用本端点。纪律「先审计后动作」：
// 先把 incident_action 事件写入防篡改审计链（checksum 链），再执行本副本的即时
// 内存吊销（PAT hash / JWT session）。持久化动作（api_tokens/users 状态、模型
// enabled、session 吊销快照表）全部由 console 完成——网关只做「链上留痕 + 即时生效」。
//
// 动作语义：
//   - terminate_session: TargetID=JWT sessionId → sessionRevocations.InvalidateLocal（即时 401）
//   - revoke_pat:        TargetHash=SHA256(token) → patVerifier.RevokeByHash（即时 401）
//   - disable_user:      纯记录（outcome=recorded）；其 PAT/session 子动作由 console 逐项调用
//   - block_model:       纯记录（outcome=recorded）；执行体是 console 的 provider enabled=false

type incidentActionRequest struct {
	IncidentID string `json:"incident_id"`
	Action     string `json:"action"` // terminate_session | revoke_pat | disable_user | block_model
	TargetType string `json:"target_type"`
	TargetID   string `json:"target_id"`
	TargetHash string `json:"target_hash"` // revoke_pat 必填：SHA256(plain token)
	Actor      string `json:"actor"`
	TenantID   string `json:"tenant_id"`
}

func validIncidentAction(action string) bool {
	switch action {
	case "terminate_session", "revoke_pat", "disable_user", "block_model":
		return true
	}
	return false
}

func (s *Server) handleInternalIncidentAction(w http.ResponseWriter, r *http.Request) {
	if !gatewayInternalAuthorized(r) {
		writeAPIError(w, openai.Unauthorized("unauthorized"))
		return
	}
	var body incidentActionRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, openai.BadRequest("invalid body"))
		return
	}
	body.Action = strings.TrimSpace(body.Action)
	body.TargetID = strings.TrimSpace(body.TargetID)
	body.TargetHash = strings.TrimSpace(body.TargetHash)
	body.TenantID = strings.TrimSpace(body.TenantID)
	if !validIncidentAction(body.Action) {
		writeAPIError(w, openai.BadRequest("invalid action"))
		return
	}
	if body.TenantID == "" {
		writeAPIError(w, openai.BadRequest("tenant_id required"))
		return
	}
	if body.Action == "terminate_session" && body.TargetID == "" {
		writeAPIError(w, openai.BadRequest("target_id (session id) required"))
		return
	}
	if body.Action == "revoke_pat" && body.TargetHash == "" {
		writeAPIError(w, openai.BadRequest("target_hash (sha256 of token) required"))
		return
	}

	// 先审计后执行：动作先落防篡改链，落链失败即拒绝执行（凭据类 fail-closed），
	// 落链成功后再执行本副本的即时内存吊销。
	outcome := "recorded"
	switch body.Action {
	case "revoke_pat":
		if s.patVerifier != nil {
			outcome = "executed"
		}
	case "terminate_session":
		if s.sessionRevocations != nil {
			outcome = "executed"
		}
	}
	if err := s.writeAuditEvent(audit.Event{
		ID:        makeID("incident_action"),
		TenantID:  body.TenantID,
		EventTime: time.Now().UTC().Format(time.RFC3339),
		EventType: "incident_action",
		UserID:    body.Actor,
		SessionID: body.TargetID,
		Route:     "incident-response",
		ClientType: "gateway",
		IncidentAction: &audit.IncidentActionRecord{
			IncidentID: body.IncidentID,
			Action:     body.Action,
			TargetType: body.TargetType,
			TargetID:   body.TargetID,
			TargetHash: body.TargetHash,
			Actor:      body.Actor,
			Outcome:    outcome,
		},
	}); err != nil {
		writeAPIError(w, openai.Internal("audit write failed"))
		return
	}
	// 审计已落链：执行即时吊销。
	switch body.Action {
	case "revoke_pat":
		if s.patVerifier != nil {
			s.patVerifier.RevokeByHash(body.TargetHash)
		}
	case "terminate_session":
		if s.sessionRevocations != nil {
			s.sessionRevocations.InvalidateLocal(body.TargetID)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"code":    "00000",
		"message": "ok",
		"data":    map[string]any{"action": body.Action, "outcome": outcome},
	})
}
