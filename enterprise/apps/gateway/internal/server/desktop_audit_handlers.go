package server

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/audit"
)

type desktopActionEvent struct {
	EventID        string `json:"event_id"`
	TS             string `json:"ts"`
	Kind           string `json:"kind"`
	SessionID      string `json:"session_id"`
	AgentID        string `json:"agent_id"`
	ToolName       string `json:"tool_name"`
	Subject        string `json:"subject"`
	Outcome        string `json:"outcome"`
	DecisionSource string `json:"decision_source"`
	Risk           string `json:"risk"`
	ArgsDigest     string `json:"args_digest"`
	Summary        string `json:"summary"`
}

type desktopActionBatch struct {
	Events []desktopActionEvent `json:"events"`
}

func (s *Server) handleDesktopActionAudit(w http.ResponseWriter, r *http.Request) {
	identity, err := s.identityFromRequest(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if !identity.AuthViaPAT || !hasScope(identity.Scopes, "desktop:managed") {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "desktop:managed required"})
		return
	}
	if s.audit == nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"accepted": 0,
			"error":    "audit writer unavailable",
		})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 512*1024)
	var body desktopActionBatch
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	count := len(body.Events)
	if count < 1 || count > 200 {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "events must contain 1 to 200 items",
		})
		return
	}

	now := time.Now().UTC()
	accepted := 0
	for _, item := range body.Events {
		ev := desktopEventToAudit(identity, item, now)
		if err := s.audit.Write(&ev); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{
				"accepted": accepted,
				"error":    err.Error(),
			})
			return
		}
		accepted++
	}
	writeJSON(w, http.StatusOK, map[string]int{"accepted": accepted})
}

func desktopEventToAudit(identity requestIdentity, item desktopActionEvent, now time.Time) audit.Event {
	toolName := item.ToolName
	mcpTool := item.Subject
	if mcpTool == "" {
		mcpTool = toolName
	}
	var hits []audit.PolicyHit
	switch {
	case item.DecisionSource == "enterprise_policy":
		hits = []audit.PolicyHit{{
			PolicyID:    "desktop-agent-policy",
			Action:      "block",
			MatchedRule: item.Subject,
		}}
	case item.Risk == "policy":
		hits = []audit.PolicyHit{{
			PolicyID:    "desktop-agent-policy",
			Action:      "ask",
			MatchedRule: item.Subject,
		}}
	}
	return audit.Event{
		ID:           desktopAuditID(item.EventID),
		TenantID:     identity.TenantID,
		UserID:       identity.UserID,
		DepartmentID: identity.DepartmentID,
		APITokenID:   identity.APITokenID,
		EventTime:    desktopEventTime(item.TS, now),
		EventType:    "desktop_agent_action",
		SessionID:    item.SessionID,
		ClientType:   "near-desktop",
		Route:        "desktop-agent",
		MCPToolName:  mcpTool,
		ToolsCalled:  []string{toolName},
		MCPInputHash: item.ArgsDigest,
		MCPStatus:    item.Kind + ":" + item.Outcome,
		PoliciesHit:  hits,
		Digest: &audit.Digest{
			PromptHash:      item.ArgsDigest,
			PromptSummary:   item.Summary,
			ResponseSummary: item.DecisionSource,
		},
	}
}

func desktopAuditID(eventID string) string {
	body := eventID
	if len(body) > 22 {
		body = body[:22]
	}
	return "dsk_" + body
}

func desktopEventTime(ts string, now time.Time) string {
	parsed, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		return now.UTC().Format(time.RFC3339)
	}
	delta := parsed.Sub(now)
	if delta < 0 {
		delta = -delta
	}
	if delta > 7*24*time.Hour {
		return now.UTC().Format(time.RFC3339)
	}
	return parsed.UTC().Format(time.RFC3339)
}
