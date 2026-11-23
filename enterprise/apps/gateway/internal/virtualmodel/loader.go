package virtualmodel

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/gatewayinternal"
)

const defaultReloadInterval = 5 * time.Second

// errRemote404Keep matches the providers loader text so operators can grep one phrase.
var errRemote404Keep = errors.New("remote 404, keeping last known good")

type snapshot struct {
	models []Model
}

// Loader polls GATEWAY_REMOTE_VIRTUAL_MODELS_URL.
// Parse failures and a remote 404 after a good snapshot keep the last snapshot.
// The loader is not registered with configstatus.
type Loader struct {
	path    string
	remote  bool
	logger  *slog.Logger
	current atomic.Pointer[snapshot]
	hasGood atomic.Bool
	mu      sync.Mutex
	rng     *rand.Rand
}

// New reads GATEWAY_REMOTE_VIRTUAL_MODELS_URL. An unset or non-HTTP value leaves the snapshot empty.
func New(logger *slog.Logger) *Loader {
	if logger == nil {
		logger = slog.Default()
	}
	url := strings.TrimSpace(os.Getenv("GATEWAY_REMOTE_VIRTUAL_MODELS_URL"))
	l := &Loader{
		logger: logger,
		rng:    rand.New(rand.NewSource(time.Now().UnixNano())),
	}
	if gatewayinternal.IsHTTPURL(url) {
		l.path = url
		l.remote = true
	}
	l.current.Store(&snapshot{})
	return l
}

// SetSnapshot replaces the in-memory snapshot. Tests use it; reload does not call it.
func (l *Loader) SetSnapshot(models []Model) {
	if l == nil {
		return
	}
	l.current.Store(&snapshot{models: append([]Model(nil), models...)})
	l.hasGood.Store(true)
}

// Start loads once, then polls. A missing URL is a no-op.
func (l *Loader) Start(ctx context.Context) {
	if l == nil || !l.remote {
		return
	}
	if err := l.reload(); err != nil {
		l.logger.Warn("virtual models snapshot not loaded", "path", l.path, "error", err)
	} else {
		l.logger.Info("virtual models snapshot loaded", "path", l.path, "models", len(l.snapshot().models))
	}
	go func() {
		ticker := time.NewTicker(defaultReloadInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := l.reload(); err != nil {
					l.logger.Debug("reload virtual models snapshot failed", "error", err)
				}
			}
		}
	}()
}

func (l *Loader) snapshot() *snapshot {
	if l == nil {
		return &snapshot{}
	}
	snap := l.current.Load()
	if snap == nil {
		return &snapshot{}
	}
	return snap
}

func (l *Loader) reload() error {
	if l == nil || !l.remote {
		return nil
	}
	raw, applied, err := l.readPayload()
	if err != nil {
		return err
	}
	if !applied {
		if !l.hasGood.Load() {
			l.current.Store(&snapshot{})
		}
		return nil
	}
	var parsed struct {
		VirtualModels []Model `json:"virtualModels"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return err
	}
	if parsed.VirtualModels == nil {
		parsed.VirtualModels = []Model{}
	}
	l.current.Store(&snapshot{models: parsed.VirtualModels})
	l.hasGood.Store(true)
	return nil
}

func (l *Loader) readPayload() (raw []byte, applied bool, err error) {
	body, code, getErr := gatewayinternal.HTTPGet(l.path)
	if getErr != nil {
		return nil, false, getErr
	}
	if code == http.StatusNotFound {
		if l.hasGood.Load() {
			return nil, false, errRemote404Keep
		}
		return nil, false, nil
	}
	if code < 200 || code >= 300 {
		return nil, false, errors.New("remote virtual models: http " + http.StatusText(code))
	}
	return body, true, nil
}

// Plan resolves a request model. ok is false when the name is not an enabled virtual model.
func (l *Loader) Plan(tenantID, name string, available func(model string) bool) (order []string, virtualName string, ok bool) {
	if l == nil {
		return nil, "", false
	}
	vm, found := l.find(tenantID, name)
	if !found {
		return nil, "", false
	}
	l.mu.Lock()
	order = Plan(vm.Targets, available, l.rng)
	l.mu.Unlock()
	if len(order) == 0 {
		return nil, "", false
	}
	return order, vm.Name, true
}

func (l *Loader) find(tenantID, name string) (Model, bool) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Model{}, false
	}
	tenantID = strings.TrimSpace(tenantID)
	for _, vm := range l.snapshot().models {
		if !vm.Enabled || strings.TrimSpace(vm.Name) != name {
			continue
		}
		if tenantID != "" && !strings.EqualFold(strings.TrimSpace(vm.TenantID), tenantID) {
			continue
		}
		return vm, true
	}
	return Model{}, false
}
