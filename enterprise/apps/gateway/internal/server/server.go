package server

import (
	"bytes"
	"context"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"

	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/adaptor"
	"github.com/agenticx/enterprise/gateway/internal/audit"
	gatewayauth "github.com/agenticx/enterprise/gateway/internal/auth"
	"github.com/agenticx/enterprise/gateway/internal/billing"
	"github.com/agenticx/enterprise/gateway/internal/cache"
	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/config"
	"github.com/agenticx/enterprise/gateway/internal/database"
	"github.com/agenticx/enterprise/gateway/internal/gatewayinternal"
	"github.com/agenticx/enterprise/gateway/internal/gwerrors"
	"github.com/agenticx/enterprise/gateway/internal/keypool"
	"github.com/agenticx/enterprise/gateway/internal/mcp"
	"github.com/agenticx/enterprise/gateway/internal/mcphost"
	"github.com/agenticx/enterprise/gateway/internal/metering"
	"github.com/agenticx/enterprise/gateway/internal/observability"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/provider"
	"github.com/agenticx/enterprise/gateway/internal/quota"
	"github.com/agenticx/enterprise/gateway/internal/relay"
	"github.com/agenticx/enterprise/gateway/internal/residency"
	"github.com/agenticx/enterprise/gateway/internal/routing"
	"github.com/agenticx/enterprise/gateway/internal/runtimeconfig"
	"github.com/agenticx/enterprise/gateway/internal/wasmhost"
	policyengine "github.com/agenticx/enterprise/policy-engine"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/blake2b"
)

type Server struct {
	cfg                   config.Config
	logger                *slog.Logger
	provider              provider.ChatProvider
	decider               *routing.Decider
	policy                *policyengine.Engine
	policyMu              sync.RWMutex
	policyManifest        string
	policySnapshot        string
	policySnapshotMod     time.Time
	policyOverride        string
	policyOverrideMod     time.Time
	audit                 audit.EventWriter
	metering              metering.Sink
	traceReporter         *metering.TraceReporter
	adminLoader           *runtimeconfig.Loader
	quotaTracker          *quota.Tracker
	policySnapBodyHash    string
	policyRemoteCheckedAt time.Time
	channelRegistry       *channel.Registry
	channelPicker         *channel.Picker
	channelStats          *channel.StatsStore
	channelAffinity       *channel.AffinityStore
	adaptorFactory        *adaptor.Factory
	keyPool               *keypool.Pool
	relayExecutor         *relay.Executor
	billingService        *billing.Service
	patVerifier           *gatewayauth.PATVerifier
	sessionGrants         *gatewayauth.SessionGrantStore
	compliance            *residency.ComplianceStore
	cacheService          *cache.Service
	pricing               *metering.PricingTable
	pricingLoader         *metering.PricingLoader
	metrics               *observability.Registry
	database              *database.Handle
	redisStore            *cache.RedisStore
	mcpHost               *mcphost.Host
	mcpStreamable         mcphost.StreamableHTTPTransport
	mcpSSE                *mcphost.SSETransport
	mcpRegistry           *mcp.Registry
	mcpLoader             *mcp.Loader
	mcpProxy              *mcp.Handler
	wasmManager           *wasmhost.Manager
	errorStore            *gwerrors.Store
	channelProber         *channel.Prober
}

var (
	publicKeyOnce sync.Once
	publicKey     *rsa.PublicKey
	publicKeyErr  error
)

func New(cfg config.Config, logger *slog.Logger) (*Server, error) {
	// metering：开发态可选数据库，未配 DATABASE_URL 时降级到本地 jsonl，
	// 让前台 token chip 与 admin 看用量都能继续工作而不必启数据库。
	dbURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	var dbHandle *database.Handle
	if dbURL != "" {
		handle, err := database.OpenFromEnv()
		if err != nil {
			logger.Warn("database unavailable", "error", err)
		} else {
			dbHandle = handle
		}
	}

	var sink metering.Sink
	usageLogPath := strings.TrimSpace(os.Getenv("GATEWAY_USAGE_LOG"))
	if usageLogPath == "" {
		usageLogPath = "./.runtime/usage.jsonl"
	}
	if dbHandle != nil {
		reporter, err := metering.NewReporter(dbHandle, logger)
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

	var traceReporter *metering.TraceReporter
	if dbHandle != nil {
		if reporter, err := metering.NewTraceReporter(dbHandle, logger); err != nil {
			logger.Warn("trace reporter unavailable", "error", err)
		} else {
			traceReporter = reporter
		}
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
	policySnapshotPath := strings.TrimSpace(os.Getenv("GATEWAY_REMOTE_POLICY_SNAPSHOT_URL"))
	if policySnapshotPath == "" {
		policySnapshotPath = strings.TrimSpace(os.Getenv("GATEWAY_POLICY_SNAPSHOT_FILE"))
		if policySnapshotPath == "" {
			policySnapshotPath = filepath.Join(filepath.Dir(quotaCfgPath), "policy-snapshot.json")
		}
	}

	engine, snapshotModTime, snapBodyHash, overrideModTime, err := buildPolicyEngine(cfg.PolicyManifest, policySnapshotPath, policyOverridePath)
	if err != nil {
		return nil, err
	}

	fileWriter := audit.NewFileWriter(cfg.AuditDir)
	var auditWriter audit.EventWriter = fileWriter
	var patVerifier *gatewayauth.PATVerifier
	if dbHandle != nil {
		patVerifier = gatewayauth.NewPATVerifier(dbHandle)
		auditWriter = audit.NewDualWriter(fileWriter, audit.NewPgWriter(dbHandle), cfg.AuditDir, logger)
		days := audit.BackfillDaysFromEnv()
		realHandle := dbHandle
		realDays := days
		realDir := cfg.AuditDir
		go func() {
			if err := audit.RunBackfill(context.Background(), realHandle, realDir, realDays, logger); err != nil {
				logger.Warn("audit backfill failed", "error", err)
			}
		}()
	} else if dbURL != "" {
		logger.Warn("audit database unavailable, using file-only audit")
	}

	srv := &Server{
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

		policySnapBodyHash: snapBodyHash,
		audit:              auditWriter,
		metering:           sink,
		traceReporter:      traceReporter,
		adminLoader:        adminLoader,
		quotaTracker:       quota.NewTracker(quotaCfgPath, quotaUsagePath, dbHandle),
		patVerifier:        patVerifier,
		sessionGrants:      gatewayauth.NewSessionGrantStore(dbHandle),
		compliance:         residency.NewComplianceStore(dbHandle),
		cacheService:       nil,
		pricingLoader:      initPricingLoader(logger),
		metrics:            observability.NewRegistryFromEnv(),
		database:           dbHandle,
	}
	cacheSvc, redisStore := initCacheService(logger)
	srv.cacheService = cacheSvc
	srv.redisStore = redisStore
	srv.initMCPHost()
	srv.initMCPProxy()
	srv.initChannelRelay()
	if dbHandle != nil {
		if budgetReporter, err := quota.NewBudgetAlertReporter(dbHandle, logger); err != nil {
			logger.Warn("budget alert reporter unavailable", "error", err)
		} else {
			srv.quotaTracker.SetBudgetAlertSink(budgetReporter.Emit)
		}
	}
	srv.errorStore = gwerrors.NewStore()
	srv.channelProber = channel.NewProber()
	srv.initWasmHost()
	observability.InitPyroscopeFromEnv()
	return srv, nil
}

func sha256Hex(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func snapshotManifestsFromRaw(raw []byte, mod time.Time) ([]policyengine.RulePackManifest, time.Time, error) {
	var parsed policySnapshotStoreFile
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, mod, fmt.Errorf("parse policy snapshot file: %w", err)
	}
	if len(parsed.Tenants) == 0 {
		return nil, mod, nil
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
				case policyengine.RuleKindField:
					if value, ok := rule.Payload["jsonPath"].(string); ok {
						nextRule.JSONPath = value
					}
					if value, ok := rule.Payload["target"].(string); ok {
						nextRule.FieldTarget = value
					}
					if value, ok := rule.Payload["fieldAction"].(string); ok {
						nextRule.FieldAction = value
					}
				}
				manifest.Rules = append(manifest.Rules, nextRule)
			}
			manifests = append(manifests, manifest)
		}
	}
	return manifests, mod, nil
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

func buildPolicyEngine(manifestGlob, snapshotPath, overridePath string) (*policyengine.Engine, time.Time, string, time.Time, error) {
	manifests, snapshotMod, snapHash, err := loadPolicySnapshot(snapshotPath)
	if err != nil {
		return nil, time.Time{}, "", time.Time{}, err
	}
	if len(manifests) > 0 {
		engine, buildErr := policyengine.NewEngine(manifests)
		if buildErr != nil {
			return nil, time.Time{}, "", time.Time{}, fmt.Errorf("build snapshot policy engine: %w", buildErr)
		}
		return engine, snapshotMod, snapHash, time.Time{}, nil
	}

	disabled, modTime, err := readDisabledPolicyPacks(overridePath)
	if err != nil {
		return nil, time.Time{}, "", time.Time{}, err
	}
	manifestsGlob, err := policyengine.LoadRulePacksWithDisabled(manifestGlob, disabled)
	if err != nil {
		return nil, time.Time{}, "", time.Time{}, fmt.Errorf("load policy manifests: %w", err)
	}
	engine, err := policyengine.NewEngine(manifestsGlob)
	if err != nil {
		return nil, time.Time{}, "", time.Time{}, fmt.Errorf("build policy engine: %w", err)
	}
	return engine, time.Time{}, snapHash, modTime, nil
}

func loadPolicySnapshot(snapshotPath string) ([]policyengine.RulePackManifest, time.Time, string, error) {
	path := strings.TrimSpace(snapshotPath)
	if path == "" {
		return nil, time.Time{}, "", nil
	}
	if gatewayinternal.IsHTTPURL(path) {
		raw, code, err := gatewayinternal.HTTPGet(path)
		if err != nil {
			return nil, time.Time{}, "", err
		}
		if code == http.StatusNotFound {
			return nil, time.Time{}, "", nil
		}
		if code < 200 || code >= 300 {
			return nil, time.Time{}, "", fmt.Errorf("policy snapshot fetch returned http %d", code)
		}
		mod := time.Now().UTC()
		manifests, _, err := snapshotManifestsFromRaw(raw, mod)
		if err != nil {
			return nil, mod, "", err
		}
		return manifests, mod, sha256Hex(raw), nil
	}

	info, statErr := os.Stat(path)
	if statErr != nil {
		if os.IsNotExist(statErr) {
			return nil, time.Time{}, "", nil
		}
		return nil, time.Time{}, "", fmt.Errorf("stat policy snapshot file: %w", statErr)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, time.Time{}, "", fmt.Errorf("read policy snapshot file: %w", err)
	}
	mod := info.ModTime()
	manifests, mod, err := snapshotManifestsFromRaw(raw, mod)
	return manifests, mod, "", err
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

// policyRemoteReloadInterval controls how often GATEWAY_REMOTE_POLICY_SNAPSHOT_URL is
// re-fetched. Stream chunks call evaluatePolicy per token; without throttling, each
// chunk pays a full HTTP round-trip to admin-console (~100–300ms locally) and the UI
// appears stuck on "Thinking" / dribbles tokens. Channel registry already polls at 5s.
func policyRemoteReloadInterval() time.Duration {
	raw := strings.TrimSpace(os.Getenv("GATEWAY_POLICY_REMOTE_RELOAD_INTERVAL"))
	if raw == "" {
		return 5 * time.Second
	}
	if raw == "0" {
		return 0
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d < 0 {
		return 5 * time.Second
	}
	return d
}

func (s *Server) shouldFetchRemotePolicy(now time.Time) bool {
	interval := policyRemoteReloadInterval()
	if interval <= 0 {
		return true
	}
	s.policyMu.RLock()
	checkedAt := s.policyRemoteCheckedAt
	s.policyMu.RUnlock()
	if checkedAt.IsZero() {
		return true
	}
	return now.Sub(checkedAt) >= interval
}

func (s *Server) markRemotePolicyChecked(now time.Time) {
	s.policyMu.Lock()
	s.policyRemoteCheckedAt = now
	s.policyMu.Unlock()
}

func (s *Server) reloadPolicyIfNeeded() {
	if strings.TrimSpace(s.policyOverride) == "" && strings.TrimSpace(s.policySnapshot) == "" {
		return
	}

	var nextOverrideMod time.Time
	if ov := strings.TrimSpace(s.policyOverride); ov != "" {
		info, err := os.Stat(ov)
		if err != nil {
			if !os.IsNotExist(err) {
				s.logger.Warn("policy override stat failed", "path", ov, "error", err)
				return
			}
		} else {
			nextOverrideMod = info.ModTime()
		}
	}

	snap := strings.TrimSpace(s.policySnapshot)
	snapChanged := false
	if snap != "" {
		if gatewayinternal.IsHTTPURL(snap) {
			now := time.Now()
			if !s.shouldFetchRemotePolicy(now) {
				// Keep serving the in-memory engine; still allow override-file mtime below.
			} else {
				raw, code, err := gatewayinternal.HTTPGet(snap)
				s.markRemotePolicyChecked(now)
				if err != nil {
					s.logger.Warn("policy snapshot fetch failed", "url", snap, "error", err)
					return
				}
				var sum string
				switch {
				case code == http.StatusNotFound:
					sum = ""
				case code >= 200 && code < 300:
					sum = sha256Hex(raw)
				default:
					s.logger.Warn("policy snapshot bad status", "url", snap, "code", code)
					return
				}
				s.policyMu.RLock()
				snapChanged = sum != s.policySnapBodyHash
				s.policyMu.RUnlock()
			}
		} else {
			info, err := os.Stat(snap)
			if err != nil {
				if !os.IsNotExist(err) {
					s.logger.Warn("policy snapshot stat failed", "path", snap, "error", err)
					return
				}
			} else {
				nextMod := info.ModTime()
				s.policyMu.RLock()
				snapChanged = !nextMod.Equal(s.policySnapshotMod)
				s.policyMu.RUnlock()
			}
		}
	}

	overrideChanged := false
	s.policyMu.RLock()
	curOverrideMod := s.policyOverrideMod
	s.policyMu.RUnlock()
	if !nextOverrideMod.Equal(curOverrideMod) {
		overrideChanged = true
	}

	if !snapChanged && !overrideChanged {
		return
	}

	engine, snapshotMod, snapHash, overrideMod, buildErr := buildPolicyEngine(s.policyManifest, s.policySnapshot, s.policyOverride)
	if buildErr != nil {
		s.logger.Warn("policy reload failed", "snapshot", s.policySnapshot, "override", s.policyOverride, "error", buildErr)
		return
	}
	s.policyMu.Lock()
	s.policy = engine
	s.policySnapshotMod = snapshotMod
	s.policyOverrideMod = overrideMod
	s.policySnapBodyHash = snapHash
	s.policyMu.Unlock()
	s.logger.Info("policy engine reloaded", "snapshot", s.policySnapshot, "override_file", s.policyOverride)
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(10 * time.Minute))
	if s.metrics != nil && s.metrics.Enabled() {
		r.Use(s.metrics.HTTPMiddleware())
	}

	r.Get("/healthz", s.handleHealth)
	r.Get("/readyz", s.handleReady)
	if s.metrics != nil && s.metrics.Enabled() {
		r.Handle("/metrics", s.metrics.Handler())
	}
	r.Get("/internal/channel-stats", s.handleChannelStats)
	r.Get("/internal/keypool-stats", s.handleKeypoolStats)
	r.Post("/internal/keypool/reset", s.handleKeypoolReset)
	r.Post("/internal/cache/reload", s.handleCacheConfigReload)
	r.Post("/internal/cache/evict", s.handleCacheEvict)
	r.Get("/internal/plugins", s.handleInternalPluginsList)
	r.Post("/internal/plugins/reload", s.handleInternalPluginsReload)
	r.Post("/internal/plugins/upload", s.handleInternalPluginsUpload)
	r.Get("/internal/errors", s.handleInternalErrors)
	r.Get("/internal/perf", s.handleInternalPerf)
	r.Post("/internal/channels/{id}/probe", s.handleInternalChannelProbe)
	r.Post("/v1/chat/completions", s.handleChatCompletions)
	r.Post("/v1/embeddings", s.handleEmbeddings)
	if claudeInboundEnabled() {
		r.Post("/v1/messages", s.handleClaudeMessages)
	}
	if geminiInboundEnabled() {
		r.Post("/v1beta/models/{model}:generateContent", func(w http.ResponseWriter, r *http.Request) {
			s.handleGeminiGenerate(w, r, chi.URLParam(r, "model"), false)
		})
		r.Post("/v1beta/models/{model}:streamGenerateContent", func(w http.ResponseWriter, r *http.Request) {
			s.handleGeminiGenerate(w, r, chi.URLParam(r, "model"), true)
		})
	}
	if responsesInboundEnabled() {
		r.Post("/v1/responses", s.handleResponses)
	}
	s.registerMCPRoutes(r)
	s.registerMCPProxyRoutes(r)

	return r
}

func (s *Server) handleChatCompletions(w http.ResponseWriter, r *http.Request) {
	startedAt := time.Now()
	identity, err := s.identityFromRequest(r)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "auth:pat") {
			writeAPIError(w, openai.Unauthorized(msg))
		} else {
			writeAPIError(w, openai.Unauthorized("invalid or missing bearer token"))
		}
		return
	}
	if !s.hasEffectiveScope(r, identity, "workspace:chat") {
		writeAPIError(w, openai.Forbidden("missing workspace:chat scope"))
		return
	}
	if identity.AuthViaPAT && identity.APITokenID > 0 && s.patVerifier != nil {
		s.patVerifier.NoteUsed(identity.APITokenID)
	}

	var req openai.ChatCompletionRequest
	rawBody, err := io.ReadAll(r.Body)
	if err != nil {
		writeAPIError(w, openai.BadRequest("invalid request body"))
		return
	}
	if err := json.Unmarshal(rawBody, &req); err != nil {
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

	cbResult, crossOk := s.enforceCrossBorder(w, r, identity, decision, startedAt, joinMessages(req.Messages))
	if !crossOk {
		return
	}

	pluginCtx := s.newPluginHookContext(identity, r, pluginRouteFromRequest(r))
	if s.runWasmRequestHooks(w, pluginCtx, rawBody) {
		_ = s.writeAuditEvent(audit.Event{
			ID:             makeID("audit"),
			TenantID:       identity.TenantID,
			EventTime:      time.Now().UTC().Format(time.RFC3339),
			EventType:      "policy_hit",
			UserID:         identity.UserID,
			UserEmail:      identity.UserEmail,
			DepartmentID:   identity.DepartmentID,
			SessionID:      identity.SessionID,
			ClientType:     "web-portal",
			ClientIP:       r.RemoteAddr,
			Model:          req.Model,
			Route:          decision.Route,
			Digest:         &audit.Digest{PromptHash: hashText(joinMessages(req.Messages))},
			LatencyMS:      time.Since(startedAt).Milliseconds(),
			PluginsInvoked: append([]string(nil), pluginCtx.Invoked...),
		})
		return
	}

	qctx := s.quotaContext(identity, req.Model)
	defer s.billingService.ReleaseContext(qctx)

	latestUserText := latestUserMessageContent(req.Messages)
	reqPolicy := s.evaluatePolicy(latestUserText, makeEvalContext(identity, "request"))
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
	if reqPolicy.RedactedText != latestUserText {
		req.Messages = replaceLastUserMessageContent(req.Messages, reqPolicy.RedactedText)
	}
	estimatedInputTokens := estimateTextTokens(joinMessages(req.Messages))
	reserveTokens := estimateTokensWithMax(estimatedInputTokens, maxTokensFromRequest(req))
	budgetCheck, quotaReservation, ok := s.runChatQuotaGate(w, r, qctx, identity, &req, &decision, estimatedInputTokens, reserveTokens)
	if !ok {
		return
	}
	_ = quotaReservation

	cacheCtx := cacheServeContext{
		w: w, r: r, req: req, identity: identity, decision: decision, startedAt: startedAt,
		estimatedInputTokens: estimatedInputTokens, reservedTokens: reserveTokens,
		inboundProtocol: inboundProtocolLabel("openai-chat"),
		budgetCheck:     &budgetCheck,
	}
	if s.tryServeFromCache(cacheCtx) {
		return
	}

	if req.Stream {
		s.handleStream(w, r, req, decision, startedAt, identity, estimatedInputTokens, reserveTokens, pluginCtx, budgetCheck, qctx)
		return
	}

	if s.useChannelRelay() {
		s.handleChatCompleteRelay(w, r, req, startedAt, identity, estimatedInputTokens, reserveTokens, pluginCtx, qctx)
		return
	}

	resp, err := s.provider.Complete(r.Context(), req, decision)
	if err != nil {
		s.rollbackChatQuotaAndBudget(identity, req.Model, estimatedInputTokens, budgetCheck)
		writeAPIError(w, openai.Internal(err.Error()))
		return
	}
	responseContent := ""
	if len(resp.Choices) > 0 {
		msg := &resp.Choices[0].Message
		responseContent = openai.ComposeMessageContent(openai.ContentText(msg.Content), msg.ReasoningContent)
		msg.Content = openai.NewStringContent(responseContent)
		msg.ReasoningContent = ""
	}
	providerInputTokens := resp.Usage.PromptTokens
	providerOutputTokens := resp.Usage.CompletionTokens
	if providerInputTokens == 0 {
		providerInputTokens = estimatedInputTokens
	}
	if providerOutputTokens == 0 {
		providerOutputTokens = estimateTextTokens(responseContent)
	}
	s.reportUsageDetailed(identity, decision, resp.Usage, &budgetCheck)
	s.reconcileQuotaUsage(identity, req.Model, estimatedInputTokens, providerInputTokens+providerOutputTokens)

	s.writeChatCache(identity.TenantID, identity.UserID, req, cache.Entry{
		Stream:   false,
		Response: resp,
		Usage:    resp.Usage,
	})

	if len(resp.Choices) > 0 {
		respPolicy := s.evaluatePolicy(openai.ContentText(resp.Choices[0].Message.Content), makeEvalContext(identity, "response"))
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
					ResponseHash: hashText(openai.ContentText(resp.Choices[0].Message.Content)),
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
		if respPolicy.RedactedText != openai.ContentText(resp.Choices[0].Message.Content) {
			resp.Choices[0].Message.Content = openai.NewStringContent(respPolicy.RedactedText)
		}
	}

	if fieldOut, fieldResult := s.applyResponseFieldPolicy(identity, resp); fieldResult.Blocked {
		s.writeFieldPolicyBlock(w, identity, r, fieldResult)
		return
	} else if rawField, err := json.Marshal(fieldOut); err == nil {
		var patched openai.ChatCompletionResponse
		if err := json.Unmarshal(rawField, &patched); err == nil {
			resp = patched
		}
	}

	s.transformChatResponseJSON(pluginCtx, &resp)
	if len(resp.Choices) > 0 {
		responseContent = openai.ComposeMessageContent(openai.ContentText(resp.Choices[0].Message.Content), resp.Choices[0].Message.ReasoningContent)
	}

	chatAudit := s.auditChatCall(audit.Event{
		ID:                makeID("audit"),
		TenantID:          identity.TenantID,
		EventTime:         time.Now().UTC().Format(time.RFC3339),
		EventType:         "chat_call",
		UserID:            identity.UserID,
		UserEmail:         identity.UserEmail,
		DepartmentID:      identity.DepartmentID,
		SessionID:         identity.SessionID,
		ClientType:        "web-portal",
		ClientIP:          r.RemoteAddr,
		Provider:          decision.Provider,
		Model:             req.Model,
		Route:             decision.Route,
		InboundProtocol:   inboundProtocolLabel("openai-chat"),
		InputTokens:       estimateTextTokens(joinMessages(req.Messages)),
		OutputTokens:      estimateTextTokens(responseContent),
		TotalTokens:       estimateTextTokens(joinMessages(req.Messages)) + estimateTextTokens(responseContent),
		LatencyMS:         time.Since(startedAt).Milliseconds(),
		LatencyMSUpstream: time.Since(startedAt).Milliseconds(),
		Digest: &audit.Digest{
			PromptHash:      hashText(joinMessages(req.Messages)),
			ResponseHash:    hashText(responseContent),
			PromptSummary:   summarize(joinMessages(req.Messages), 120),
			ResponseSummary: summarize(responseContent, 120),
		},
	}, cache.LayerNone, "", 0, time.Since(startedAt).Milliseconds())
	applyCrossBorderAuditFields(&chatAudit, cbResult)
	applyPluginsInvoked(&chatAudit, pluginCtx)
	if err := s.writeAuditEvent(chatAudit); err != nil {
		writeAPIError(w, openai.Internal("audit write failed"))
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleEmbeddings(w http.ResponseWriter, r *http.Request) {
	startedAt := time.Now()
	identity, err := s.identityFromRequest(r)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "auth:pat") {
			writeAPIError(w, openai.Unauthorized(msg))
		} else {
			writeAPIError(w, openai.Unauthorized("invalid or missing bearer token"))
		}
		return
	}
	if !s.hasEffectiveScope(r, identity, "workspace:chat") {
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
		s.rollbackQuotaReservation(s.quotaContext(identity, req.Model), estimatedInputTokens)
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
	reservedTokens int64,
	pluginCtx *wasmhost.HookContext,
	budgetCheck quota.CheckResult,
	qctx quota.RequestContext,
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
	var reasoningState openai.StreamReasoningState
	var streamChunks []openai.StreamChunk
	var firstTokenAt time.Time
	if s.metrics != nil {
		s.metrics.IncActiveStreams(req.Model)
		defer s.metrics.DecActiveStreams(req.Model)
	}

	push := func(chunk openai.StreamChunk) error {
		if firstTokenAt.IsZero() {
			firstTokenAt = time.Now()
			if s.metrics != nil {
				s.metrics.ObserveTTFT(req.Model, decision.ChannelID, inboundProtocolLabel("openai-chat"), firstTokenAt.Sub(startedAt))
			}
		}
		if len(chunk.Choices) > 0 {
			delta := &chunk.Choices[0].Delta
			delta.Content = openai.NormalizeThinkTags(delta.Content)
			delta.ReasoningContent = openai.NormalizeThinkTags(delta.ReasoningContent)
			merged := reasoningState.MergeDelta(responseBuilder.String(), delta.ReasoningContent, delta.Content)
			if merged != "" {
				policyResult := s.evaluatePolicy(merged, makeEvalContext(identity, "response"))
				if policyResult.Blocked {
					blockedHits = append(blockedHits, policyResult.Hits...)
					return fmt.Errorf("policy blocked stream chunk")
				}
				delta.Content = policyResult.RedactedText
				responseBuilder.WriteString(delta.Content)
			}
			delta.ReasoningContent = ""
		}
		streamChunks = append(streamChunks, chunk)
		payload, err := json.Marshal(chunk)
		if err != nil {
			return err
		}
		payload = s.applyWasmStreamChunk(pluginCtx, payload)
		if _, err := w.Write([]byte("data: " + string(payload) + "\n\n")); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	}

	var streamErr error
	var streamResult relay.StreamResult
	if s.useChannelRelay() {
		streamResult, streamErr = s.relayExecutor.Stream(r.Context(), req, req.Model, channelIdentity(identity), push)
		decision = routingDecisionFromStream(streamResult, req.Model, decision)
	} else {
		streamErr = s.provider.Stream(r.Context(), req, decision, push)
	}

	if streamErr != nil {
		if s.useChannelRelay() {
			s.billingService.RollbackContext(qctx, reservedTokens)
		}
		if len(blockedHits) > 0 {
			ev := audit.Event{
				ID:            makeID("audit"),
				TenantID:      identity.TenantID,
				EventTime:     time.Now().UTC().Format(time.RFC3339),
				EventType:     "policy_hit",
				UserID:        identity.UserID,
				UserEmail:     identity.UserEmail,
				DepartmentID:  identity.DepartmentID,
				SessionID:     identity.SessionID,
				ClientType:    "web-portal",
				ClientIP:      r.RemoteAddr,
				Provider:      decision.Provider,
				Model:         req.Model,
				Route:         decision.Route,
				ChannelID:     decision.ChannelID,
				ChannelKeyRef: streamResult.KeyRef,
				Digest: &audit.Digest{
					PromptHash:   hashText(inputText),
					ResponseHash: hashText(responseBuilder.String()),
				},
				PoliciesHit: toAuditPolicyHits(blockedHits),
				LatencyMS:   time.Since(startedAt).Milliseconds(),
			}
			enrichAuditFromAttempts(&ev, streamResult.Attempts)
			enrichAuditRoutingPolicy(&ev, streamResult.PickDecision)
			_ = s.writeAuditEvent(ev)
			writeStreamPolicyError(w, flusher, "90002", "响应触发合规拦截", blockedHits)
			partialOutputTokens := estimateTextTokens(responseBuilder.String())
			s.reportUsage(identity, decision, estimatedInputTokens, partialOutputTokens)
			if !s.useChannelRelay() {
				s.reconcileQuotaUsage(identity, req.Model, estimatedInputTokens, estimatedInputTokens+partialOutputTokens)
			}
			return
		}
		partialOutputTokens := estimateTextTokens(responseBuilder.String())
		s.reportUsage(identity, decision, estimatedInputTokens, partialOutputTokens)
		if s.useChannelRelay() {
			actualTotal := int64(estimatedInputTokens + partialOutputTokens)
			s.billingService.SettleContext(
				qctx,
				reservedTokens,
				actualTotal,
			)
		} else {
			s.reconcileQuotaUsage(identity, req.Model, estimatedInputTokens, estimatedInputTokens+partialOutputTokens)
		}
		if code := streamErrorCode(streamErr); code != "" {
			writeStreamPolicyError(w, flusher, code, formatStreamError(streamErr), nil)
		} else {
			writeStreamError(w, flusher, streamErr.Error())
		}
		return
	}

	responseText := responseBuilder.String()
	if tail := reasoningState.CloseOpenReasoning(); tail != "" {
		responseText += tail
		tailChunk := openai.StreamChunk{
			Choices: []openai.StreamChoice{{
				Index: 0,
				Delta: openai.StreamDelta{Content: tail},
			}},
		}
		_ = push(tailChunk)
	}
	inputTokens := estimatedInputTokens
	outputTokens := estimateTextTokens(responseText)
	streamUsage := openai.Usage{
		PromptTokens:     inputTokens,
		CompletionTokens: outputTokens,
		TotalTokens:      inputTokens + outputTokens,
	}
	s.reportUsageDetailed(identity, decision, streamUsage, &budgetCheck)
	if s.metrics != nil && !firstTokenAt.IsZero() {
		s.metrics.ObserveTPS(req.Model, decision.ChannelID, outputTokens, time.Since(firstTokenAt))
	}
	s.writeChatCache(identity.TenantID, identity.UserID, req, cache.BuildStreamEntry(streamChunks, streamUsage, req.Model))
	var settleDelta int64
	if s.useChannelRelay() {
		settle := s.billingService.SettleContext(
			qctx,
			reservedTokens,
			int64(inputTokens+outputTokens),
		)
		settleDelta = settle.Delta
	} else {
		s.reconcileQuotaUsage(identity, req.Model, estimatedInputTokens, inputTokens+outputTokens)
	}

	ev := audit.Event{
		ID:              makeID("audit"),
		TenantID:        identity.TenantID,
		EventTime:       time.Now().UTC().Format(time.RFC3339),
		EventType:       "chat_call",
		UserID:          identity.UserID,
		UserEmail:       identity.UserEmail,
		DepartmentID:    identity.DepartmentID,
		SessionID:       identity.SessionID,
		ClientType:      "web-portal",
		ClientIP:        r.RemoteAddr,
		Provider:        decision.Provider,
		Model:           req.Model,
		Route:           decision.Route,
		ChannelID:       decision.ChannelID,
		ChannelKeyRef:   streamResult.KeyRef,
		InputTokens:     inputTokens,
		OutputTokens:    outputTokens,
		TotalTokens:     inputTokens + outputTokens,
		LatencyMS:       time.Since(startedAt).Milliseconds(),
		EstimatedTokens: estimatedInputTokens,
		ActualTokens:    inputTokens + outputTokens,
		SettleDelta:     settleDelta,
		Digest: &audit.Digest{
			PromptHash:      hashText(inputText),
			ResponseHash:    hashText(responseText),
			PromptSummary:   summarize(inputText, 120),
			ResponseSummary: summarize(responseText, 120),
		},
	}
	enrichAuditFromAttempts(&ev, streamResult.Attempts)
	enrichAuditRoutingPolicy(&ev, streamResult.PickDecision)
	applyPluginsInvoked(&ev, pluginCtx)
	if err := s.writeAuditEvent(ev); err != nil {
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
		text := strings.TrimSpace(openai.ContentText(msg.Content))
		if text == "" {
			continue
		}
		parts = append(parts, text)
	}
	return strings.Join(parts, "\n")
}

// latestUserMessageContent 返回最后一条 user 消息的 content。
// 仅当本轮新增的 user 输入需要单独评估（如 request 阶段策略扫描）时使用，
// 避免历史轮次中残留的 PII/敏感词导致整个会话不可用。
// 若没有任何 user 消息，则回退到 joinMessages 全量内容，保留原始行为。
func latestUserMessageContent(messages []openai.ChatMessage) string {
	for i := len(messages) - 1; i >= 0; i-- {
		msg := messages[i]
		if strings.EqualFold(msg.Role, "user") && strings.TrimSpace(openai.ContentText(msg.Content)) != "" {
			return openai.ContentText(msg.Content)
		}
	}
	return joinMessages(messages)
}

// replaceLastUserMessageContent 仅替换最后一条 user 消息的 content，
// 保留多轮对话结构，避免把整段历史压成单条 user message。
func replaceLastUserMessageContent(messages []openai.ChatMessage, content string) []openai.ChatMessage {
	for i := len(messages) - 1; i >= 0; i-- {
		if strings.EqualFold(messages[i].Role, "user") {
			next := make([]openai.ChatMessage, len(messages))
			copy(next, messages)
			next[i].Content = openai.NewStringContent(content)
			return next
		}
	}
	return messages
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
	DataResidency string
	APITokenID    int64
	AuthViaPAT    bool
	TraceID       string
	TraceStep     int
}

func (s *Server) quotaContext(identity requestIdentity, model string) quota.RequestContext {
	apiTokenID := ""
	if identity.APITokenID > 0 {
		apiTokenID = fmt.Sprintf("%d", identity.APITokenID)
	}
	return quota.RequestContext{
		TenantID:   identity.TenantID,
		UserID:     identity.UserID,
		DeptID:     identity.DepartmentID,
		APITokenID: apiTokenID,
		Role:       roleFromScopes(identity.Scopes),
		Model:      model,
	}
}

func (s *Server) applyQuotaHeaders(w http.ResponseWriter, check quota.CheckResult) {
	for k, v := range check.Headers {
		w.Header().Set(k, v)
	}
}

func (s *Server) writeQuotaError(w http.ResponseWriter, check quota.CheckResult) {
	msg := check.Description
	if msg == "" {
		msg = "policy:quota:exceeded"
	}
	writeAPIError(w, openai.QuotaExceeded(msg))
}

func (s *Server) identityFromRequest(r *http.Request) (requestIdentity, error) {
	token := bearerToken(r.Header.Get("authorization"))
	if token == "" {
		return requestIdentity{}, errors.New("missing bearer token")
	}
	if strings.HasPrefix(token, "agx-pat-") {
		if s.patVerifier == nil {
			return requestIdentity{}, errors.New("auth:pat:database_unavailable")
		}
		pat, err := s.patVerifier.Verify(r.Context(), token)
		if err != nil {
			return requestIdentity{}, err
		}
		return enrichTraceFromRequest(requestIdentity{
			TenantID:     pat.TenantID,
			UserID:       pat.UserID,
			DepartmentID: pat.DeptID,
			Scopes:       pat.Scopes,
			ClientType:   "api-token",
			APITokenID:   pat.APITokenID,
			AuthViaPAT:   true,
		}, r), nil
	}
	fromJWT, err := parseIdentityFromJWT(token)
	if err != nil {
		return requestIdentity{}, err
	}
	return enrichTraceFromRequest(fromJWT, r), nil
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
	DataResidency  string   `json:"dataResidency"`
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
		DataResidency: residency.NormalizeRegion(claims.DataResidency),
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
	s.reportUsageDetailed(identity, decision, openai.Usage{
		PromptTokens:     inputTokens,
		CompletionTokens: outputTokens,
		TotalTokens:      inputTokens + outputTokens,
	}, nil)
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
	qctx := s.quotaContext(identity, model)
	if delta < 0 {
		s.rollbackQuotaReservation(qctx, -delta)
		return
	}
	decision := s.quotaTracker.CheckAndAddContext(qctx, int64(delta), quota.LedgerEventSettle)
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

func (s *Server) rollbackQuotaReservation(qctx quota.RequestContext, tokens int) {
	if tokens <= 0 {
		return
	}
	if ok := s.quotaTracker.RollbackContext(qctx, int64(tokens)); !ok {
		s.logger.Warn("quota rollback failed",
			"user_id", qctx.UserID,
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
	ruleMessages := make([]string, 0, len(hits))
	seenMessage := map[string]struct{}{}
	for _, hit := range hits {
		id := strings.TrimSpace(hit.RuleID)
		if id == "" {
		} else {
			if _, ok := seen[id]; !ok {
				seen[id] = struct{}{}
				policyIDs = append(policyIDs, id)
			}
		}
		msg := strings.TrimSpace(hit.Message)
		if msg == "" {
			continue
		}
		if _, ok := seenMessage[msg]; ok {
			continue
		}
		seenMessage[msg] = struct{}{}
		ruleMessages = append(ruleMessages, msg)
	}
	if len(ruleMessages) > 0 {
		if len(policyIDs) > 0 {
			return fmt.Sprintf("%s：%s（命中策略: %s）", message, strings.Join(ruleMessages, "；"), strings.Join(policyIDs, ", "))
		}
		return fmt.Sprintf("%s：%s", message, strings.Join(ruleMessages, "；"))
	}
	if len(policyIDs) > 0 {
		return fmt.Sprintf("%s（命中策略: %s）", message, strings.Join(policyIDs, ", "))
	}
	return message
}
