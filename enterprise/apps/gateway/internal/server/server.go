package server

import (
	"crypto/rsa"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/config"
	"github.com/agenticx/enterprise/gateway/internal/metering"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/provider"
	"github.com/agenticx/enterprise/gateway/internal/routing"
	policyengine "github.com/agenticx/enterprise/policy-engine"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/blake2b"
)

type Server struct {
	cfg      config.Config
	logger   *slog.Logger
	provider provider.ChatProvider
	decider  *routing.Decider
	policy   *policyengine.Engine
	audit    *audit.FileWriter
	metering *metering.Reporter
}

var (
	publicKeyOnce sync.Once
	publicKey     *rsa.PublicKey
	publicKeyErr  error
)

func New(cfg config.Config, logger *slog.Logger) (*Server, error) {
	manifests, err := policyengine.LoadRulePacks(cfg.PolicyManifest)
	if err != nil {
		return nil, fmt.Errorf("load policy manifests: %w", err)
	}
	engine, err := policyengine.NewEngine(manifests)
	if err != nil {
		return nil, fmt.Errorf("build policy engine: %w", err)
	}
	dbURL, err := databaseURL()
	if err != nil {
		return nil, err
	}
	meteringReporter, err := metering.NewReporter(dbURL, logger)
	if err != nil {
		return nil, fmt.Errorf("init metering reporter: %w", err)
	}

	return &Server{
		cfg:      cfg,
		logger:   logger,
		provider: provider.NewOpenAICompatibleProvider(),
		decider:  routing.NewDecider(cfg),
		policy:   engine,
		audit:    audit.NewFileWriter(cfg.AuditDir),
		metering: meteringReporter,
	}, nil
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

	r.Get("/healthz", s.handleHealth)
	r.Post("/v1/chat/completions", s.handleChatCompletions)

	return r
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"code":    "00000",
		"message": "ok",
		"data": map[string]any{
			"service": "agenticx-gateway",
			"status":  "healthy",
			"time":    time.Now().UTC().Format(time.RFC3339),
		},
	})
}

func (s *Server) handleChatCompletions(w http.ResponseWriter, r *http.Request) {
	startedAt := time.Now()
	identity, err := identityFromRequest(r)
	if err != nil {
		writeAPIError(w, openai.Unauthorized("invalid or missing bearer token"))
		return
	}
	if !hasScope(identity.Scopes, "workspace:chat") {
		writeAPIError(w, openai.Forbidden("missing workspace:chat scope"))
		return
	}

	var req openai.ChatCompletionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, openai.BadRequest("invalid request body"))
		return
	}
	if strings.TrimSpace(req.Model) == "" {
		writeAPIError(w, openai.BadRequest("model is required"))
		return
	}
	if len(req.Messages) == 0 {
		writeAPIError(w, openai.BadRequest("messages is required"))
		return
	}

	decision := s.decider.Decide(r, req.Model)
	s.logger.Info("gateway routing decision",
		"model", req.Model,
		"route", decision.Route,
		"provider", decision.Provider,
		"endpoint", decision.Endpoint,
	)

	reqPolicy := s.policy.Evaluate(joinMessages(req.Messages), "request")
	if reqPolicy.Blocked {
		s.logger.Warn("policy blocked request", "model", req.Model, "hits", len(reqPolicy.Hits))
		if err := s.writeAuditEvent(audit.Event{
			ID:           makeID("audit"),
			TenantID:     identity.TenantID,
			EventTime:    time.Now().UTC().Format(time.RFC3339),
			EventType:    "policy_hit",
			UserID:       identity.UserID,
			UserEmail:    identity.UserEmail,
			DepartmentID: identity.DepartmentID,
			SessionID:    identity.SessionID,
			ClientType:   "web-portal",
			ClientIP:     r.RemoteAddr,
			Model:        req.Model,
			Provider:     decision.Provider,
			Route:        decision.Route,
			Digest: &audit.Digest{
				PromptHash: hashText(joinMessages(req.Messages)),
			},
			PoliciesHit:  toAuditPolicyHits(reqPolicy.Hits),
			LatencyMS:    time.Since(startedAt).Milliseconds(),
			InputTokens:  estimateTextTokens(joinMessages(req.Messages)),
			OutputTokens: 0,
			TotalTokens:  estimateTextTokens(joinMessages(req.Messages)),
		}); err != nil {
			writeAPIError(w, openai.Internal("audit write failed"))
			return
		}
		writePolicyError(w, "请求触发合规拦截", reqPolicy.Hits)
		return
	}
	if reqPolicy.RedactedText != joinMessages(req.Messages) {
		req.Messages = []openai.ChatMessage{
			{
				Role:    "user",
				Content: reqPolicy.RedactedText,
			},
		}
	}

	if req.Stream {
		s.handleStream(w, r, req, decision, startedAt, identity)
		return
	}

	resp, err := s.provider.Complete(r.Context(), req, decision)
	if err != nil {
		writeAPIError(w, openai.Internal(err.Error()))
		return
	}
	if len(resp.Choices) > 0 {
		respPolicy := s.policy.Evaluate(resp.Choices[0].Message.Content, "response")
		if respPolicy.Blocked {
			s.logger.Warn("policy blocked response", "model", req.Model, "hits", len(respPolicy.Hits))
			if err := s.writeAuditEvent(audit.Event{
				ID:           makeID("audit"),
				TenantID:     identity.TenantID,
				EventTime:    time.Now().UTC().Format(time.RFC3339),
				EventType:    "policy_hit",
				UserID:       identity.UserID,
				UserEmail:    identity.UserEmail,
				DepartmentID: identity.DepartmentID,
				SessionID:    identity.SessionID,
				ClientType:   "web-portal",
				ClientIP:     r.RemoteAddr,
				Provider:     decision.Provider,
				Model:        req.Model,
				Route:        decision.Route,
				Digest: &audit.Digest{
					PromptHash:   hashText(joinMessages(req.Messages)),
					ResponseHash: hashText(resp.Choices[0].Message.Content),
				},
				PoliciesHit: toAuditPolicyHits(respPolicy.Hits),
				LatencyMS:   time.Since(startedAt).Milliseconds(),
			}); err != nil {
				writeAPIError(w, openai.Internal("audit write failed"))
				return
			}
			writePolicyError(w, "响应触发合规拦截", respPolicy.Hits)
			return
		}
		if respPolicy.RedactedText != resp.Choices[0].Message.Content {
			resp.Choices[0].Message.Content = respPolicy.RedactedText
		}
	}
	responseContent := ""
	if len(resp.Choices) > 0 {
		responseContent = resp.Choices[0].Message.Content
	}
	if err := s.writeAuditEvent(audit.Event{
		ID:           makeID("audit"),
		TenantID:     identity.TenantID,
		EventTime:    time.Now().UTC().Format(time.RFC3339),
		EventType:    "chat_call",
		UserID:       identity.UserID,
		UserEmail:    identity.UserEmail,
		DepartmentID: identity.DepartmentID,
		SessionID:    identity.SessionID,
		ClientType:   "web-portal",
		ClientIP:     r.RemoteAddr,
		Provider:     decision.Provider,
		Model:        req.Model,
		Route:        decision.Route,
		InputTokens:  estimateTextTokens(joinMessages(req.Messages)),
		OutputTokens: estimateTextTokens(responseContent),
		TotalTokens:  estimateTextTokens(joinMessages(req.Messages)) + estimateTextTokens(responseContent),
		LatencyMS:    time.Since(startedAt).Milliseconds(),
		Digest: &audit.Digest{
			PromptHash:      hashText(joinMessages(req.Messages)),
			ResponseHash:    hashText(responseContent),
			PromptSummary:   summarize(joinMessages(req.Messages), 120),
			ResponseSummary: summarize(responseContent, 120),
		},
	}); err != nil {
		writeAPIError(w, openai.Internal("audit write failed"))
		return
	}
	s.reportUsage(identity, decision, joinMessages(req.Messages), responseContent)
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleStream(
	w http.ResponseWriter,
	r *http.Request,
	req openai.ChatCompletionRequest,
	decision routing.Decision,
	startedAt time.Time,
	identity requestIdentity,
) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeAPIError(w, openai.Internal("streaming unsupported"))
		return
	}

	var responseBuilder strings.Builder
	inputText := joinMessages(req.Messages)

	push := func(chunk openai.StreamChunk) error {
		if len(chunk.Choices) > 0 {
			deltaContent := chunk.Choices[0].Delta.Content
			policyResult := s.policy.Evaluate(deltaContent, "response")
			if policyResult.Blocked {
				return fmt.Errorf("policy blocked stream chunk")
			}
			chunk.Choices[0].Delta.Content = policyResult.RedactedText
			responseBuilder.WriteString(chunk.Choices[0].Delta.Content)
		}
		payload, err := json.Marshal(chunk)
		if err != nil {
			return err
		}
		if _, err := w.Write([]byte("data: " + string(payload) + "\n\n")); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	}

	if err := s.provider.Stream(r.Context(), req, decision, push); err != nil {
		writeAPIError(w, openai.Internal(err.Error()))
		return
	}

	responseText := responseBuilder.String()
	if err := s.writeAuditEvent(audit.Event{
		ID:           makeID("audit"),
		TenantID:     identity.TenantID,
		EventTime:    time.Now().UTC().Format(time.RFC3339),
		EventType:    "chat_call",
		UserID:       identity.UserID,
		UserEmail:    identity.UserEmail,
		DepartmentID: identity.DepartmentID,
		SessionID:    identity.SessionID,
		ClientType:   "web-portal",
		ClientIP:     r.RemoteAddr,
		Provider:     decision.Provider,
		Model:        req.Model,
		Route:        decision.Route,
		InputTokens:  estimateTextTokens(inputText),
		OutputTokens: estimateTextTokens(responseText),
		TotalTokens:  estimateTextTokens(inputText) + estimateTextTokens(responseText),
		LatencyMS:    time.Since(startedAt).Milliseconds(),
		Digest: &audit.Digest{
			PromptHash:      hashText(inputText),
			ResponseHash:    hashText(responseText),
			PromptSummary:   summarize(inputText, 120),
			ResponseSummary: summarize(responseText, 120),
		},
	}); err != nil {
		writeStreamError(w, flusher, "audit write failed")
		return
	}
	s.reportUsage(identity, decision, inputText, responseText)

	_, _ = w.Write([]byte("data: [DONE]\n\n"))
	flusher.Flush()
}

func writeAPIError(w http.ResponseWriter, apiErr openai.APIError) {
	writeJSON(w, apiErr.HTTPStatus, map[string]any{
		"error": map[string]string{
			"code":    apiErr.Code,
			"message": apiErr.Message,
		},
	})
}

func writePolicyError(w http.ResponseWriter, message string, hits []policyengine.HitEvent) {
	writeJSON(w, openai.PolicyBlocked(message).HTTPStatus, map[string]any{
		"error": map[string]any{
			"code":    "90001",
			"message": message,
			"hits":    hits,
		},
	})
}

func writeJSON(w http.ResponseWriter, statusCode int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(payload)
}

func joinMessages(messages []openai.ChatMessage) string {
	parts := make([]string, 0, len(messages))
	for _, msg := range messages {
		if strings.TrimSpace(msg.Content) == "" {
			continue
		}
		parts = append(parts, msg.Content)
	}
	return strings.Join(parts, "\n")
}

type requestIdentity struct {
	TenantID     string
	UserID       string
	UserEmail    string
	DepartmentID string
	SessionID    string
	Scopes       []string
}

func identityFromRequest(r *http.Request) (requestIdentity, error) {
	token := bearerToken(r.Header.Get("authorization"))
	if token == "" {
		return requestIdentity{}, errors.New("missing bearer token")
	}
	fromJWT, err := parseIdentityFromJWT(token)
	if err != nil {
		return requestIdentity{}, err
	}
	return fromJWT, nil
}

func bearerToken(authHeader string) string {
	parts := strings.SplitN(strings.TrimSpace(authHeader), " ", 2)
	if len(parts) != 2 {
		return ""
	}
	if !strings.EqualFold(parts[0], "bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

type accessClaims struct {
	UserID       string   `json:"userId"`
	TenantID     string   `json:"tenantId"`
	Email        string   `json:"email"`
	DepartmentID string   `json:"deptId"`
	SessionID    string   `json:"sessionId"`
	Scopes       []string `json:"scopes"`
	Type         string   `json:"typ"`
	jwt.RegisteredClaims
}

func parseIdentityFromJWT(token string) (requestIdentity, error) {
	pub, err := getPublicKey()
	if err != nil {
		return requestIdentity{}, err
	}
	claims := &accessClaims{}
	parsed, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		if t.Method.Alg() != jwt.SigningMethodRS256.Alg() {
			return nil, fmt.Errorf("unexpected signing method: %s", t.Method.Alg())
		}
		return pub, nil
	}, jwt.WithIssuer("agenticx-enterprise-web-portal"), jwt.WithAudience("agenticx-web-users"))
	if err != nil {
		return requestIdentity{}, fmt.Errorf("verify token: %w", err)
	}
	if !parsed.Valid {
		return requestIdentity{}, errors.New("token invalid")
	}
	if claims.Type != "access" {
		return requestIdentity{}, errors.New("token type must be access")
	}
	if strings.TrimSpace(claims.UserID) == "" || strings.TrimSpace(claims.TenantID) == "" {
		return requestIdentity{}, errors.New("token missing identity claims")
	}
	return requestIdentity{
		TenantID:     strings.TrimSpace(claims.TenantID),
		UserID:       strings.TrimSpace(claims.UserID),
		UserEmail:    strings.TrimSpace(claims.Email),
		DepartmentID: strings.TrimSpace(claims.DepartmentID),
		SessionID:    strings.TrimSpace(claims.SessionID),
		Scopes:       sanitizeScopes(claims.Scopes),
	}, nil
}

func getPublicKey() (*rsa.PublicKey, error) {
	publicKeyOnce.Do(func() {
		pem := strings.TrimSpace(os.Getenv("AUTH_JWT_PUBLIC_KEY"))
		if pem == "" {
			publicKeyErr = errors.New("AUTH_JWT_PUBLIC_KEY is required")
			return
		}
		publicKey, publicKeyErr = jwt.ParseRSAPublicKeyFromPEM([]byte(pem))
	})
	return publicKey, publicKeyErr
}

func hashText(text string) string {
	sum := blake2b.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}

func summarize(text string, maxLen int) string {
	trimmed := strings.TrimSpace(text)
	if len(trimmed) <= maxLen {
		return trimmed
	}
	return trimmed[:maxLen] + "..."
}

func estimateTextTokens(text string) int {
	if strings.TrimSpace(text) == "" {
		return 0
	}
	size := len([]rune(text))
	tokens := size / 3
	if size%3 != 0 {
		tokens += 1
	}
	if tokens == 0 {
		return 1
	}
	return tokens
}

func toAuditPolicyHits(hits []policyengine.HitEvent) []audit.PolicyHit {
	out := make([]audit.PolicyHit, 0, len(hits))
	for _, hit := range hits {
		out = append(out, audit.PolicyHit{
			PolicyID:    hit.RuleID,
			Severity:    hit.Severity,
			Action:      string(hit.Action),
			MatchedRule: hit.RuleID,
		})
	}
	return out
}

func makeID(prefix string) string {
	return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
}

func (s *Server) writeAuditEvent(event audit.Event) error {
	if err := s.audit.Write(event); err != nil {
		s.logger.Error("write audit event failed", "error", err)
		return err
	}
	return nil
}

func (s *Server) reportUsage(identity requestIdentity, decision routing.Decision, prompt, response string) {
	inputTokens := estimateTextTokens(prompt)
	outputTokens := estimateTextTokens(response)
	total := inputTokens + outputTokens
	s.metering.ReportAsync(metering.UsageRecord{
		ID:           makeID("usage"),
		TenantID:     identity.TenantID,
		DeptID:       identity.DepartmentID,
		UserID:       identity.UserID,
		Provider:     decision.Provider,
		Model:        decision.Model,
		Route:        decision.Route,
		TimeBucket:   time.Now().UTC(),
		InputTokens:  inputTokens,
		OutputTokens: outputTokens,
		TotalTokens:  total,
		CostUSD:      float64(total) * 0.000001,
	})
}

func databaseURL() (string, error) {
	if value := strings.TrimSpace(os.Getenv("DATABASE_URL")); value != "" {
		return value, nil
	}
	return "", errors.New("DATABASE_URL is required")
}

func sanitizeScopes(scopes []string) []string {
	out := make([]string, 0, len(scopes))
	for _, scope := range scopes {
		trimmed := strings.TrimSpace(scope)
		if trimmed == "" {
			continue
		}
		out = append(out, trimmed)
	}
	return out
}

func hasScope(scopes []string, required string) bool {
	for _, scope := range scopes {
		if scope == required {
			return true
		}
	}
	return false
}

func writeStreamError(w http.ResponseWriter, flusher http.Flusher, message string) {
	payload := map[string]any{
		"error": map[string]string{
			"code":    "50000",
			"message": message,
		},
	}
	raw, _ := json.Marshal(payload)
	_, _ = w.Write([]byte("event: error\n"))
	_, _ = w.Write([]byte("data: " + string(raw) + "\n\n"))
	flusher.Flush()
}
