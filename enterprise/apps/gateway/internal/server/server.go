package server

import (
	"bytes"
	"context"
	"crypto/rsa"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/config"
	"github.com/agenticx/enterprise/gateway/internal/metering"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/provider"
	"github.com/agenticx/enterprise/gateway/internal/quota"
	"github.com/agenticx/enterprise/gateway/internal/routing"
	"github.com/agenticx/enterprise/gateway/internal/runtimeconfig"
	policyengine "github.com/agenticx/enterprise/policy-engine"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/blake2b"
)

type Server struct {
	cfg               config.Config
	logger            *slog.Logger
	provider          provider.ChatProvider
	decider           *routing.Decider
	policy            *policyengine.Engine
	policyMu          sync.RWMutex
	policyManifest    string
	policySnapshot    string
	policySnapshotMod time.Time
	policyOverride    string
	policyOverrideMod time.Time
	audit             audit.EventWriter
	metering          metering.Sink
	adminLoader       *runtimeconfig.Loader
	quotaTracker      *quota.Tracker
}

var (
	publicKeyOnce sync.Once
	publicKey     *rsa.PublicKey
	publicKeyErr  error
)

func New(cfg config.Config, logger *slog.Logger) (*Server, error) {
	// metering：开发态可选 PG，未配 DATABASE_URL 时降级到本地 jsonl，
	// 让前台 token chip 与 admin 看用量都能继续工作而不必启 PG。
	dbURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	var sink metering.Sink
	usageLogPath := strings.TrimSpace(os.Getenv("GATEWAY_USAGE_LOG"))
	if usageLogPath == "" {
		usageLogPath = "./.runtime/usage.jsonl"
	}
	if dbURL != "" {
		reporter, err := metering.NewReporter(dbURL, logger)
		if err != nil {
			logger.Warn("metering reporter unavailable, fallback to file sink", "error", err, "path", usageLogPath)
			fileSink, fileErr := metering.NewFileSink(usageLogPath, logger)
			if fileErr != nil {
				return nil, fmt.Errorf("init metering fallback file sink: %w", fileErr)
			}
			sink = fileSink
		} else {
			sink = reporter
		}
	} else {
		fileSink, err := metering.NewFileSink(usageLogPath, logger)
		if err != nil {
			return nil, fmt.Errorf("init metering file sink: %w", err)
		}
		sink = fileSink
		logger.Info("metering using file sink", "path", usageLogPath)
	}

	adminLoader := runtimeconfig.New(logger)
	adminLoader.Start(context.Background())

	quotaCfgPath := strings.TrimSpace(os.Getenv("GATEWAY_QUOTA_CONFIG_FILE"))
	if quotaCfgPath == "" {
		quotaCfgPath = quota.DefaultConfigPath()
	}
	quotaUsagePath := strings.TrimSpace(os.Getenv("GATEWAY_QUOTA_USAGE_FILE"))
	if quotaUsagePath == "" {
		quotaUsagePath = quota.DefaultUsagePath()
	}
	policyOverridePath := strings.TrimSpace(os.Getenv("GATEWAY_POLICY_OVERRIDE_FILE"))
	if policyOverridePath == "" {
		policyOverridePath = filepath.Join(filepath.Dir(quotaCfgPath), "policy-overrides.json")
	}
	policySnapshotPath := strings.TrimSpace(os.Getenv("GATEWAY_POLICY_SNAPSHOT_FILE"))
	if policySnapshotPath == "" {
		policySnapshotPath = filepath.Join(filepath.Dir(quotaCfgPath), "policy-snapshot.json")
	}

	engine, snapshotModTime, overrideModTime, err := buildPolicyEngine(cfg.PolicyManifest, policySnapshotPath, policyOverridePath)
	if err != nil {
		return nil, err
	}

	fileWriter := audit.NewFileWriter(cfg.AuditDir)
	var auditWriter audit.EventWriter = fileWriter
	if dbURL != "" {
		pool, aerr := audit.NewPgxPool(dbURL)
		if aerr != nil {
			logger.Warn("audit pg unavailable, using file-only audit", "error", aerr)
		} else {
			auditWriter = audit.NewDualWriter(fileWriter, audit.NewPgWriter(pool), cfg.AuditDir, logger)
			days := audit.BackfillDaysFromEnv()
			realPool := pool
			realDays := days
			realDir := cfg.AuditDir
			go func() {
				if err := audit.RunBackfill(context.Background(), realPool, realDir, realDays, logger); err != nil {
					logger.Warn("audit backfill failed", "error", err)
				}
			}()
		}
	}

	return &Server{
		cfg:               cfg,
		logger:            logger,
		provider:          provider.NewOpenAICompatibleProvider(),
		decider:           routing.NewDeciderWithAdmin(cfg, adminLoader),
		policy:            engine,
		policyManifest:    cfg.PolicyManifest,
		policySnapshot:    policySnapshotPath,
		policySnapshotMod: snapshotModTime,
		policyOverride:    policyOverridePath,
		policyOverrideMod: overrideModTime,
		audit:             auditWriter,
		metering:          sink,
		adminLoader:       adminLoader,
		quotaTracker:      quota.NewTracker(quotaCfgPath, quotaUsagePath),
	}, nil
}

type policyOverrideFile struct {
	DisabledPacks []string `json:"disabledPacks"`
}

type policySnapshotStoreFile struct {
	UpdatedAt string                          `json:"updatedAt"`
	Tenants   map[string]tenantPolicySnapshot `json:"tenants"`
}

type tenantPolicySnapshot struct {
	Version int                `json:"version"`
	Packs   []snapshotPackItem `json:"packs"`
}

type snapshotPackItem struct {
	Code      string                  `json:"code"`
	Name      string                  `json:"name"`
	Type      string                  `json:"type"`
	Source    string                  `json:"source"`
	AppliesTo *policyengine.AppliesTo `json:"appliesTo"`
	Rules     []snapshotRuleItem      `json:"rules"`
}

type snapshotRuleItem struct {
	ID        string                  `json:"id"`
	Code      string                  `json:"code"`
	Kind      policyengine.RuleKind   `json:"kind"`
	Action    policyengine.Action     `json:"action"`
	Severity  string                  `json:"severity"`
	Message   string                  `json:"message"`
	Payload   map[string]any          `json:"payload"`
	AppliesTo *policyengine.AppliesTo `json:"appliesTo"`
}

func buildPolicyEngine(manifestGlob, snapshotPath, overridePath string) (*policyengine.Engine, time.Time, time.Time, error) {
	if manifests, snapshotMod, err := loadPolicySnapshot(snapshotPath); err != nil {
		return nil, time.Time{}, time.Time{}, err
	} else if len(manifests) > 0 {
		engine, buildErr := policyengine.NewEngine(manifests)
		if buildErr != nil {
			return nil, time.Time{}, time.Time{}, fmt.Errorf("build snapshot policy engine: %w", buildErr)
		}
		return engine, snapshotMod, time.Time{}, nil
	}

	disabled, modTime, err := readDisabledPolicyPacks(overridePath)
	if err != nil {
		return nil, time.Time{}, time.Time{}, err
	}
	manifests, err := policyengine.LoadRulePacksWithDisabled(manifestGlob, disabled)
	if err != nil {
		return nil, time.Time{}, time.Time{}, fmt.Errorf("load policy manifests: %w", err)
	}
	engine, err := policyengine.NewEngine(manifests)
	if err != nil {
		return nil, time.Time{}, time.Time{}, fmt.Errorf("build policy engine: %w", err)
	}
	return engine, time.Time{}, modTime, nil
}

func loadPolicySnapshot(snapshotPath string) ([]policyengine.RulePackManifest, time.Time, error) {
	if strings.TrimSpace(snapshotPath) == "" {
		return nil, time.Time{}, nil
	}
	info, statErr := os.Stat(snapshotPath)
	if statErr != nil {
		if os.IsNotExist(statErr) {
			return nil, time.Time{}, nil
		}
		return nil, time.Time{}, fmt.Errorf("stat policy snapshot file: %w", statErr)
	}
	raw, err := os.ReadFile(snapshotPath)
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("read policy snapshot file: %w", err)
	}
	var parsed policySnapshotStoreFile
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, time.Time{}, fmt.Errorf("parse policy snapshot file: %w", err)
	}
	if len(parsed.Tenants) == 0 {
		return nil, info.ModTime(), nil
	}
	manifests := make([]policyengine.RulePackManifest, 0)
	for tenantID, tenantSnapshot := range parsed.Tenants {
		for _, pack := range tenantSnapshot.Packs {
			manifest := policyengine.RulePackManifest{
				Name:      pack.Code,
				Version:   fmt.Sprintf("%d", tenantSnapshot.Version),
				Type:      "snapshot-pack",
				AppliesTo: pack.AppliesTo,
				Rules:     make([]policyengine.Rule, 0, len(pack.Rules)),
			}
			for _, rule := range pack.Rules {
				normalizedID := strings.TrimSpace(rule.Code)
				if normalizedID == "" {
					normalizedID = strings.TrimSpace(rule.ID)
				}
				if normalizedID == "" {
					normalizedID = makeID("policy_rule")
				}
				nextRule := policyengine.Rule{
					ID:        normalizedID,
					TenantID:  tenantID,
					Kind:      rule.Kind,
					Action:    rule.Action,
					Severity:  rule.Severity,
					Message:   rule.Message,
					AppliesTo: rule.AppliesTo,
				}
				switch rule.Kind {
				case policyengine.RuleKindKeyword:
					if values, ok := rule.Payload["keywords"].([]any); ok {
						for _, value := range values {
							if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
								nextRule.Keywords = append(nextRule.Keywords, text)
							}
						}
					}
				case policyengine.RuleKindRegex:
					if value, ok := rule.Payload["pattern"].(string); ok {
						nextRule.Pattern = value
					}
				case policyengine.RuleKindPII:
					if value, ok := rule.Payload["piiType"].(string); ok {
						nextRule.PIIType = value
					}
				}
				manifest.Rules = append(manifest.Rules, nextRule)
			}
			manifests = append(manifests, manifest)
		}
	}
	return manifests, info.ModTime(), nil
}

func readDisabledPolicyPacks(path string) (map[string]bool, time.Time, error) {
	disabled := map[string]bool{}
	if strings.TrimSpace(path) == "" {
		return disabled, time.Time{}, nil
	}
	info, statErr := os.Stat(path)
	if statErr != nil {
		if os.IsNotExist(statErr) {
			return disabled, time.Time{}, nil
		}
		return nil, time.Time{}, fmt.Errorf("stat policy override file: %w", statErr)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("read policy override file: %w", err)
	}
	var parsed policyOverrideFile
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, time.Time{}, fmt.Errorf("parse policy override file: %w", err)
	}
	for _, name := range parsed.DisabledPacks {
		clean := strings.TrimSpace(name)
		if clean != "" {
			disabled[clean] = true
		}
	}
	return disabled, info.ModTime(), nil
}

func makeEvalContext(identity requestIdentity, stage string) policyengine.EvalContext {
	roleCodes := identity.RoleCodes
	if len(roleCodes) == 0 {
		roleCodes = []string{roleFromScopes(identity.Scopes)}
	}
	deptIDs := identity.DepartmentIDs
	if len(deptIDs) == 0 && strings.TrimSpace(identity.DepartmentID) != "" {
		deptIDs = []string{identity.DepartmentID}
	}
	if len(deptIDs) == 0 {
		deptIDs = []string{"*"}
	}
	clientType := strings.TrimSpace(identity.ClientType)
	if clientType == "" {
		clientType = "web-portal"
	}
	return policyengine.EvalContext{
		TenantID:   identity.TenantID,
		DeptIDs:    deptIDs,
		RoleCodes:  roleCodes,
		UserID:     identity.UserID,
		ClientType: clientType,
		Stage:      stage,
	}
}

func (s *Server) evaluatePolicy(text string, ctx policyengine.EvalContext) policyengine.EvaluateResult {
	s.reloadPolicyIfNeeded()
	s.policyMu.RLock()
	engine := s.policy
	s.policyMu.RUnlock()
	return engine.EvaluateWithContext(text, ctx)
}

func (s *Server) reloadPolicyIfNeeded() {
	if strings.TrimSpace(s.policyOverride) == "" && strings.TrimSpace(s.policySnapshot) == "" {
		return
	}

	var nextOverrideMod time.Time
	if strings.TrimSpace(s.policyOverride) != "" {
		info, err := os.Stat(s.policyOverride)
		if err != nil {
			if !os.IsNotExist(err) {
				s.logger.Warn("policy override stat failed", "path", s.policyOverride, "error", err)
				return
			}
		} else {
			nextOverrideMod = info.ModTime()
		}
	}

	var nextSnapshotMod time.Time
	if strings.TrimSpace(s.policySnapshot) != "" {
		info, err := os.Stat(s.policySnapshot)
		if err != nil {
			if !os.IsNotExist(err) {
				s.logger.Warn("policy snapshot stat failed", "path", s.policySnapshot, "error", err)
				return
			}
		} else {
			nextSnapshotMod = info.ModTime()
		}
	}

	s.policyMu.RLock()
	currentOverrideMod := s.policyOverrideMod
	currentSnapshotMod := s.policySnapshotMod
	s.policyMu.RUnlock()
	if nextOverrideMod.Equal(currentOverrideMod) && nextSnapshotMod.Equal(currentSnapshotMod) {
		return
	}

	engine, snapshotMod, overrideMod, buildErr := buildPolicyEngine(s.policyManifest, s.policySnapshot, s.policyOverride)
	if buildErr != nil {
		s.logger.Warn("policy reload failed", "snapshot", s.policySnapshot, "override", s.policyOverride, "error", buildErr)
		return
	}
	s.policyMu.Lock()
	s.policy = engine
	s.policySnapshotMod = snapshotMod
	s.policyOverrideMod = overrideMod
	s.policyMu.Unlock()
	s.logger.Info("policy engine reloaded", "snapshot_file", s.policySnapshot, "override_file", s.policyOverride)
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(10 * time.Minute))

	r.Get("/healthz", s.handleHealth)
	r.Post("/v1/chat/completions", s.handleChatCompletions)
	r.Post("/v1/embeddings", s.handleEmbeddings)

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

	reqPolicy := s.evaluatePolicy(joinMessages(req.Messages), makeEvalContext(identity, "request"))
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
		writePolicyError(w, "90001", "请求触发合规拦截", reqPolicy.Hits)
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
	estimatedInputTokens := estimateTextTokens(joinMessages(req.Messages))
	quotaDecision := s.quotaTracker.CheckAndAdd(
		identity.UserID,
		identity.DepartmentID,
		roleFromScopes(identity.Scopes),
		req.Model,
		int64(estimatedInputTokens),
	)
	if !quotaDecision.Allowed {
		writeAPIError(w, openai.QuotaExceeded("token quota exceeded"))
		return
	}

	if req.Stream {
		s.handleStream(w, r, req, decision, startedAt, identity, estimatedInputTokens)
		return
	}

	resp, err := s.provider.Complete(r.Context(), req, decision)
	if err != nil {
		s.rollbackQuotaReservation(identity, estimatedInputTokens)
		writeAPIError(w, openai.Internal(err.Error()))
		return
	}
	responseContent := ""
	if len(resp.Choices) > 0 {
		responseContent = resp.Choices[0].Message.Content
	}
	providerInputTokens := resp.Usage.PromptTokens
	providerOutputTokens := resp.Usage.CompletionTokens
	if providerInputTokens == 0 {
		providerInputTokens = estimatedInputTokens
	}
	if providerOutputTokens == 0 {
		providerOutputTokens = estimateTextTokens(responseContent)
	}
	s.reportUsage(identity, decision, providerInputTokens, providerOutputTokens)
	s.reconcileQuotaUsage(identity, req.Model, estimatedInputTokens, providerInputTokens+providerOutputTokens)

	if len(resp.Choices) > 0 {
		respPolicy := s.evaluatePolicy(resp.Choices[0].Message.Content, makeEvalContext(identity, "response"))
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
			writePolicyError(w, "90002", "响应触发合规拦截", respPolicy.Hits)
			return
		}
		if respPolicy.RedactedText != resp.Choices[0].Message.Content {
			resp.Choices[0].Message.Content = respPolicy.RedactedText
		}
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
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleEmbeddings(w http.ResponseWriter, r *http.Request) {
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
	var payload struct {
		Model string          `json:"model"`
		Input json.RawMessage `json:"input"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeAPIError(w, openai.BadRequest("invalid request body"))
		return
	}
	if strings.TrimSpace(payload.Model) == "" {
		writeAPIError(w, openai.BadRequest("model is required"))
		return
	}
	inputs, err := normalizeEmbeddingInput(payload.Input)
	if err != nil {
		writeAPIError(w, openai.BadRequest(err.Error()))
		return
	}
	if len(inputs) == 0 {
		writeAPIError(w, openai.BadRequest("input is required"))
		return
	}
	req := openai.EmbeddingRequest{
		Model: payload.Model,
		Input: inputs,
	}
	decision := s.decider.Decide(r, req.Model)
	sanitizedInputs := make([]string, 0, len(req.Input))
	hits := make([]policyengine.HitEvent, 0)
	for _, item := range req.Input {
		reqPolicy := s.evaluatePolicy(item, makeEvalContext(identity, "request"))
		if reqPolicy.Blocked {
			hits = append(hits, reqPolicy.Hits...)
			continue
		}
		sanitizedInputs = append(sanitizedInputs, reqPolicy.RedactedText)
	}
	if len(hits) > 0 {
		joined := strings.Join(req.Input, "\n")
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
				PromptHash: hashText(joined),
			},
			PoliciesHit:  toAuditPolicyHits(hits),
			LatencyMS:    time.Since(startedAt).Milliseconds(),
			InputTokens:  estimateTextTokens(joined),
			OutputTokens: 0,
			TotalTokens:  estimateTextTokens(joined),
		}); err != nil {
			writeAPIError(w, openai.Internal("audit write failed"))
			return
		}
		writePolicyError(w, "90001", "请求触发合规拦截", hits)
		return
	}
	req.Input = sanitizedInputs
	estimatedInputTokens := estimateTextTokens(strings.Join(req.Input, "\n"))
	quotaDecision := s.quotaTracker.CheckAndAdd(
		identity.UserID,
		identity.DepartmentID,
		roleFromScopes(identity.Scopes),
		req.Model,
		int64(estimatedInputTokens),
	)
	if !quotaDecision.Allowed {
		writeAPIError(w, openai.QuotaExceeded("token quota exceeded"))
		return
	}
	resp, err := s.provider.Embeddings(r.Context(), req, decision)
	if err != nil {
		s.rollbackQuotaReservation(identity, estimatedInputTokens)
		writeAPIError(w, openai.Internal(err.Error()))
		return
	}
	inputTokens := resp.Usage.PromptTokens
	if inputTokens == 0 {
		inputTokens = estimatedInputTokens
	}
	s.reportUsage(identity, decision, inputTokens, 0)
	s.reconcileQuotaUsage(identity, req.Model, estimatedInputTokens, inputTokens)

	if err := s.writeAuditEvent(audit.Event{
		ID:           makeID("audit"),
		TenantID:     identity.TenantID,
		EventTime:    time.Now().UTC().Format(time.RFC3339),
		EventType:    "embedding_call",
		UserID:       identity.UserID,
		UserEmail:    identity.UserEmail,
		DepartmentID: identity.DepartmentID,
		SessionID:    identity.SessionID,
		ClientType:   "web-portal",
		ClientIP:     r.RemoteAddr,
		Provider:     decision.Provider,
		Model:        req.Model,
		Route:        decision.Route,
		InputTokens:  resp.Usage.PromptTokens,
		OutputTokens: 0,
		TotalTokens:  resp.Usage.TotalTokens,
		LatencyMS:    time.Since(startedAt).Milliseconds(),
		Digest: &audit.Digest{
			PromptHash:    hashText(strings.Join(req.Input, "\n")),
			ResponseHash:  hashText(fmt.Sprintf("%d", len(resp.Data))),
			PromptSummary: summarize(strings.Join(req.Input, "\n"), 120),
		},
	}); err != nil {
		writeAPIError(w, openai.Internal("audit write failed"))
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleStream(
	w http.ResponseWriter,
	r *http.Request,
	req openai.ChatCompletionRequest,
	decision routing.Decision,
	startedAt time.Time,
	identity requestIdentity,
	estimatedInputTokens int,
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
	var blockedHits []policyengine.HitEvent

	push := func(chunk openai.StreamChunk) error {
		if len(chunk.Choices) > 0 {
			deltaContent := chunk.Choices[0].Delta.Content
			policyResult := s.evaluatePolicy(deltaContent, makeEvalContext(identity, "response"))
			if policyResult.Blocked {
				blockedHits = append(blockedHits, policyResult.Hits...)
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
		if len(blockedHits) > 0 {
			_ = s.writeAuditEvent(audit.Event{
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
					PromptHash:   hashText(inputText),
					ResponseHash: hashText(responseBuilder.String()),
				},
				PoliciesHit: toAuditPolicyHits(blockedHits),
				LatencyMS:   time.Since(startedAt).Milliseconds(),
			})
			writeStreamPolicyError(w, flusher, "90002", "响应触发合规拦截", blockedHits)
			partialOutputTokens := estimateTextTokens(responseBuilder.String())
			s.reportUsage(identity, decision, estimatedInputTokens, partialOutputTokens)
			s.reconcileQuotaUsage(identity, req.Model, estimatedInputTokens, estimatedInputTokens+partialOutputTokens)
			return
		}
		partialOutputTokens := estimateTextTokens(responseBuilder.String())
		s.reportUsage(identity, decision, estimatedInputTokens, partialOutputTokens)
		s.reconcileQuotaUsage(identity, req.Model, estimatedInputTokens, estimatedInputTokens+partialOutputTokens)
		writeStreamError(w, flusher, err.Error())
		return
	}

	responseText := responseBuilder.String()
	inputTokens := estimatedInputTokens
	outputTokens := estimateTextTokens(responseText)
	s.reportUsage(identity, decision, inputTokens, outputTokens)
	s.reconcileQuotaUsage(identity, req.Model, estimatedInputTokens, inputTokens+outputTokens)

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
		InputTokens:  inputTokens,
		OutputTokens: outputTokens,
		TotalTokens:  inputTokens + outputTokens,
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

	usagePayload, _ := json.Marshal(map[string]any{
		"agenticx_usage": map[string]any{
			"input_tokens":  inputTokens,
			"output_tokens": outputTokens,
			"total_tokens":  inputTokens + outputTokens,
			"provider":      decision.Provider,
			"model":         decision.Model,
		},
	})
	_, _ = w.Write([]byte("data: " + string(usagePayload) + "\n\n"))
	flusher.Flush()

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

func writePolicyError(w http.ResponseWriter, code string, message string, hits []policyengine.HitEvent) {
	message = policyMessageWithHits(message, hits)
	writeJSON(w, openai.PolicyBlocked(message).HTTPStatus, map[string]any{
		"error": map[string]any{
			"code":    code,
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

func normalizeEmbeddingInput(raw json.RawMessage) ([]string, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return nil, errors.New("input is required")
	}
	if trimmed[0] == '"' {
		var input string
		if err := json.Unmarshal(trimmed, &input); err != nil {
			return nil, errors.New("input must be string or string[]")
		}
		if strings.TrimSpace(input) == "" {
			return nil, errors.New("input is required")
		}
		return []string{input}, nil
	}
	var inputs []string
	if err := json.Unmarshal(trimmed, &inputs); err != nil {
		return nil, errors.New("input must be string or string[]")
	}
	if len(inputs) == 0 {
		return nil, errors.New("input is required")
	}
	for _, item := range inputs {
		if strings.TrimSpace(item) == "" {
			return nil, errors.New("input contains empty string")
		}
	}
	return inputs, nil
}

type requestIdentity struct {
	TenantID      string
	UserID        string
	UserEmail     string
	DepartmentID  string
	DepartmentIDs []string
	SessionID     string
	RoleCodes     []string
	ClientType    string
	Scopes        []string
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
	UserID         string   `json:"userId"`
	TenantID       string   `json:"tenantId"`
	Email          string   `json:"email"`
	DepartmentID   string   `json:"deptId"`
	DepartmentPath []string `json:"deptPath"`
	SessionID      string   `json:"sessionId"`
	RoleCodes      []string `json:"roleCodes"`
	ClientType     string   `json:"clientType"`
	Scopes         []string `json:"scopes"`
	Type           string   `json:"typ"`
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
		TenantID:      strings.TrimSpace(claims.TenantID),
		UserID:        strings.TrimSpace(claims.UserID),
		UserEmail:     strings.TrimSpace(claims.Email),
		DepartmentID:  strings.TrimSpace(claims.DepartmentID),
		DepartmentIDs: buildDepartmentIDs(strings.TrimSpace(claims.DepartmentID), claims.DepartmentPath),
		SessionID:     strings.TrimSpace(claims.SessionID),
		RoleCodes:     sanitizeRoleCodes(claims.RoleCodes),
		ClientType:    sanitizeClientType(claims.ClientType),
		Scopes:        sanitizeScopes(claims.Scopes),
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
	ev := event
	if err := s.audit.Write(&ev); err != nil {
		s.logger.Error("write audit event failed", "error", err)
		return err
	}
	return nil
}

func (s *Server) reportUsage(identity requestIdentity, decision routing.Decision, inputTokens, outputTokens int) {
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

func (s *Server) reconcileQuotaUsage(
	identity requestIdentity,
	model string,
	estimatedInputTokens int,
	finalTotalTokens int,
) {
	delta := finalTotalTokens - estimatedInputTokens
	if delta == 0 {
		return
	}
	if delta < 0 {
		s.rollbackQuotaReservation(identity, -delta)
		return
	}
	decision := s.quotaTracker.CheckAndAdd(
		identity.UserID,
		identity.DepartmentID,
		roleFromScopes(identity.Scopes),
		model,
		int64(delta),
	)
	if !decision.Allowed {
		if usedAfter, ok := s.quotaTracker.AddUsage(identity.UserID, int64(delta)); !ok {
			s.logger.Warn("quota settle persist failed",
				"user_id", identity.UserID,
				"model", model,
				"delta_tokens", delta,
			)
		} else {
			s.logger.Warn("quota exceeded during final settle",
				"user_id", identity.UserID,
				"model", model,
				"delta_tokens", delta,
				"used_after", usedAfter,
				"limit", decision.Rule.MonthlyTokens,
			)
		}
		return
	}
	if decision.Rule.MonthlyTokens > 0 && decision.UsedAfter > decision.Rule.MonthlyTokens {
		s.logger.Warn("quota exceeded during final settle",
			"user_id", identity.UserID,
			"model", model,
			"delta_tokens", delta,
			"used_after", decision.UsedAfter,
			"limit", decision.Rule.MonthlyTokens,
		)
	}
}

func (s *Server) rollbackQuotaReservation(identity requestIdentity, tokens int) {
	if tokens <= 0 {
		return
	}
	if ok := s.quotaTracker.Rollback(identity.UserID, int64(tokens)); !ok {
		s.logger.Warn("quota rollback failed",
			"user_id", identity.UserID,
			"tokens", tokens,
		)
	}
}

// databaseURL 已在 New() 中内联读取（允许为空时降级 file sink），保留此 helper 仅为后续 admin 状态接口预留。
func databaseURL() (string, error) {
	if value := strings.TrimSpace(os.Getenv("DATABASE_URL")); value != "" {
		return value, nil
	}
	return "", errors.New("DATABASE_URL is required")
}

func buildDepartmentIDs(primary string, pathValues []string) []string {
	out := make([]string, 0, len(pathValues)+1)
	seen := map[string]struct{}{}
	if clean := strings.TrimSpace(primary); clean != "" {
		out = append(out, clean)
		seen[clean] = struct{}{}
	}
	for _, value := range pathValues {
		clean := strings.TrimSpace(value)
		if clean == "" {
			continue
		}
		if _, ok := seen[clean]; ok {
			continue
		}
		seen[clean] = struct{}{}
		out = append(out, clean)
	}
	return out
}

func sanitizeRoleCodes(codes []string) []string {
	out := make([]string, 0, len(codes))
	seen := map[string]struct{}{}
	for _, code := range codes {
		clean := strings.TrimSpace(code)
		if clean == "" {
			continue
		}
		if _, ok := seen[clean]; ok {
			continue
		}
		seen[clean] = struct{}{}
		out = append(out, clean)
	}
	return out
}

func sanitizeClientType(value string) string {
	clean := strings.TrimSpace(value)
	if clean == "" {
		return "web-portal"
	}
	return clean
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

func roleFromScopes(scopes []string) string {
	for _, scope := range scopes {
		scope = strings.ToLower(strings.TrimSpace(scope))
		switch scope {
		case "iam:admin", "role:admin", "workspace:admin", "admin":
			return "admin"
		}
	}
	return "staff"
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

func writeStreamPolicyError(
	w http.ResponseWriter,
	flusher http.Flusher,
	code string,
	message string,
	hits []policyengine.HitEvent,
) {
	message = policyMessageWithHits(message, hits)
	payload := map[string]any{
		"error": map[string]any{
			"code":    code,
			"message": message,
			"hits":    hits,
		},
	}
	raw, _ := json.Marshal(payload)
	_, _ = w.Write([]byte("event: error\n"))
	_, _ = w.Write([]byte("data: " + string(raw) + "\n\n"))
	flusher.Flush()
}

func policyMessageWithHits(message string, hits []policyengine.HitEvent) string {
	policyIDs := make([]string, 0, len(hits))
	seen := map[string]struct{}{}
	for _, hit := range hits {
		id := strings.TrimSpace(hit.RuleID)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		policyIDs = append(policyIDs, id)
	}
	if len(policyIDs) > 0 {
		return fmt.Sprintf("%s（命中策略: %s）", message, strings.Join(policyIDs, ", "))
	}
	return message
}
