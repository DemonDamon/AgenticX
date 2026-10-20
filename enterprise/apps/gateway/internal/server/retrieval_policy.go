package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/gatewayinternal"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/routing"
	policyengine "github.com/agenticx/enterprise/policy-engine"
)

const publicRetrievalSignatureWindow = 5 * time.Minute

var publicRetrievalNonces = struct {
	sync.Mutex
	seen map[string]time.Time
}{seen: map[string]time.Time{}}

func resetPublicRetrievalNoncesForTest() {
	publicRetrievalNonces.Lock()
	defer publicRetrievalNonces.Unlock()
	publicRetrievalNonces.seen = map[string]time.Time{}
}

func rememberPublicRetrievalNonce(nonce string, now time.Time) bool {
	cutoff := now.Add(-publicRetrievalSignatureWindow)
	publicRetrievalNonces.Lock()
	defer publicRetrievalNonces.Unlock()
	for key, seenAt := range publicRetrievalNonces.seen {
		if seenAt.Before(cutoff) {
			delete(publicRetrievalNonces.seen, key)
		}
	}
	if _, exists := publicRetrievalNonces.seen[nonce]; exists {
		return false
	}
	publicRetrievalNonces.seen[nonce] = now
	return true
}

func trustedPublicRetrieval(r *http.Request, rawBody []byte, provenance *openai.PolicyContext) bool {
	if provenance == nil || provenance.Source != "public-retrieval" {
		return false
	}
	token := gatewayinternal.SecretFromEnv("GATEWAY_INTERNAL_TOKEN")
	if token == "" {
		return false
	}
	timestampRaw := strings.TrimSpace(r.Header.Get("X-AgenticX-Policy-Timestamp"))
	nonce := strings.TrimSpace(r.Header.Get("X-AgenticX-Policy-Nonce"))
	if timestampRaw == "" || nonce == "" {
		return false
	}
	timestamp, err := strconv.ParseInt(timestampRaw, 10, 64)
	if err != nil {
		return false
	}
	signedAt := time.Unix(timestamp, 0)
	now := time.Now()
	if signedAt.Before(now.Add(-publicRetrievalSignatureWindow)) || signedAt.After(now.Add(publicRetrievalSignatureWindow)) {
		return false
	}
	signature, err := hex.DecodeString(r.Header.Get("X-AgenticX-Policy-Signature"))
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(token))
	_, _ = mac.Write([]byte("public-retrieval-v2\n" + r.Header.Get("Authorization") + "\n" + timestampRaw + "\n" + nonce + "\n"))
	_, _ = mac.Write(rawBody)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return false
	}
	return rememberPublicRetrievalNonce(nonce, now)
}

func hashPublicRetrievalUserText(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}

func publicRetrievalOriginalTextCandidates(messages []openai.ChatMessage) []string {
	users := make([]string, 0, len(messages))
	var systemText strings.Builder
	for _, message := range messages {
		text := strings.TrimSpace(openai.ContentText(message.Content))
		if strings.EqualFold(message.Role, "system") {
			if text != "" {
				systemText.WriteString(text)
				systemText.WriteByte('\n')
			}
			continue
		}
		if strings.EqualFold(message.Role, "user") && text != "" {
			users = append(users, text)
		}
	}

	// Planner and clarifier send the complete original input as their sole user
	// message. User-written markers must never truncate that input's provenance.
	if len(users) == 1 {
		system := systemText.String()
		if strings.Contains(system, "研究规划助手") || strings.Contains(system, "调研开题助手") {
			return []string{users[0]}
		}
	}

	// Without a trustworthy source boundary, every user message is original
	// input, including retrieved context carried in the user bucket.
	if len(users) < 2 {
		return nil
	}
	return []string{strings.Join(users, "\n\n")}
}

func publicRetrievalUserText(provenance *openai.PolicyContext, messages []openai.ChatMessage) string {
	if provenance == nil || strings.TrimSpace(provenance.UserTextSHA256) == "" {
		return ""
	}
	expected := strings.ToLower(strings.TrimSpace(provenance.UserTextSHA256))
	for _, candidate := range publicRetrievalOriginalTextCandidates(messages) {
		if hashPublicRetrievalUserText(candidate) == expected {
			return candidate
		}
	}
	return ""
}

func (s *Server) evaluateChatRequestPolicy(r *http.Request, rawBody []byte, req *openai.ChatCompletionRequest, identity *requestIdentity) policyengine.EvaluateResult {
	provenance := req.PolicyContext
	req.PolicyContext = nil
	text := latestUserMessageContent(req.Messages)
	userText := publicRetrievalUserText(provenance, req.Messages)
	if !trustedPublicRetrieval(r, rawBody, provenance) || strings.TrimSpace(userText) == "" {
		return s.evaluatePolicy(text, makeEvalContext(*identity, "request"))
	}
	for _, message := range req.Messages {
		var content string
		if json.Unmarshal(message.Content, &content) != nil {
			return s.evaluatePolicy(text, makeEvalContext(*identity, "request"))
		}
	}
	// Original user data keeps the ordinary policy even when the generated
	// prompt contains publicly retrieved evidence.
	inputPolicy := s.evaluatePolicy(userText, makeEvalContext(*identity, "request"))
	identity.PublicRetrieval = true
	retrievalCtx := makeEvalContext(*identity, "request")
	retrievalCtx.PublicRetrieval = true
	result := s.evaluatePolicy(text, retrievalCtx)
	result.Blocked = result.Blocked || inputPolicy.Blocked
	result.Hits = append(inputPolicy.Hits, result.Hits...)
	for _, hit := range inputPolicy.Hits {
		if hit.Action == policyengine.ActionRedact {
			// The caller may replace the latest message with RedactedText after
			// applying other request rules. Keep that replacement PII-safe too.
			result.RedactedText = strings.ReplaceAll(result.RedactedText, hit.Matched, "[REDACTED]")
			for i, message := range req.Messages {
				original := openai.ContentText(message.Content)
				if !strings.Contains(original, hit.Matched) {
					continue
				}
				redacted := strings.ReplaceAll(original, hit.Matched, "[REDACTED]")
				if redacted != original {
					req.Messages[i].Content = openai.NewStringContent(redacted)
				}
			}
		}
	}
	return result
}

func (s *Server) writePublicRetrievalWarnings(r *http.Request, identity requestIdentity, decision routing.Decision, model, stage, text string, hits []policyengine.HitEvent, startedAt time.Time) error {
	if !identity.PublicRetrieval {
		return nil
	}
	warnings := make([]policyengine.HitEvent, 0, len(hits))
	for _, hit := range hits {
		if hit.Action == policyengine.ActionWarn {
			warnings = append(warnings, hit)
		}
	}
	if len(warnings) == 0 {
		return nil
	}
	digest := &audit.Digest{}
	if stage == "response" {
		digest.ResponseHash = hashText(text)
	} else {
		digest.PromptHash = hashText(text)
	}
	// Audit write failures stay fail-closed, same as other policy_hit writes.
	return s.writeAuditEvent(audit.Event{
		ID:           makeID("audit"),
		TenantID:     identity.TenantID,
		EventTime:    time.Now().UTC().Format(time.RFC3339),
		EventType:    "policy_hit",
		UserID:       identity.UserID,
		UserEmail:    identity.UserEmail,
		DepartmentID: identity.DepartmentID,
		SessionID:    identity.SessionID,
		TraceID:      identity.TraceID,
		DeploymentID: identity.DeploymentID,
		ClientType:   clientTypeFromIdentity(identity),
		ClientIP:     r.RemoteAddr,
		Model:        model,
		Provider:     decision.Provider,
		Route:        decision.Route,
		Digest:       digest,
		PoliciesHit:  toAuditPolicyHits(warnings),
		LatencyMS:    time.Since(startedAt).Milliseconds(),
	})
}
