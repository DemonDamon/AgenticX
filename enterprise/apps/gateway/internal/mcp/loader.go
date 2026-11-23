package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/configstatus"
	"github.com/agenticx/enterprise/gateway/internal/gatewayinternal"
)

const (
	defaultMCPFile          = "../../.runtime/admin/mcp-servers.json"
	defaultReloadInterval   = 5 * time.Second
)

type snapshot struct {
	servers []MCPServer
}

// Loader polls local JSON or admin internal API for MCP server definitions.
type Loader struct {
	path    string
	remote  bool
	logger  *slog.Logger
	reg     *Registry
	current atomic.Pointer[snapshot]
	status  *configstatus.Registry
	hasGood atomic.Bool
}

// SetConfigStatus 在 Start 之前注入生效状态登记点。
func (l *Loader) SetConfigStatus(status *configstatus.Registry) {
	if l == nil {
		return
	}
	l.status = status
}

func NewLoader(logger *slog.Logger, reg *Registry) *Loader {
	url := strings.TrimSpace(os.Getenv("GATEWAY_REMOTE_MCP_SERVERS_URL"))
	path := strings.TrimSpace(os.Getenv("GATEWAY_MCP_SERVERS_FILE"))
	remote := false
	if gatewayinternal.IsHTTPURL(url) {
		path = url
		remote = true
	} else if path == "" {
		cwd, _ := os.Getwd()
		path = filepath.Clean(filepath.Join(cwd, defaultMCPFile))
	}
	l := &Loader{path: path, remote: remote, logger: logger, reg: reg}
	empty := &snapshot{}
	l.current.Store(empty)
	return l
}

func (l *Loader) Path() string { return l.path }

func (l *Loader) Start(ctx context.Context) {
	if err := l.reload(); err != nil {
		l.logger.Warn("mcp servers config not loaded", "path", l.path, "error", err)
	} else {
		l.logger.Info("mcp servers config loaded", "path", l.path, "count", len(l.snapshot()))
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
					l.logger.Debug("reload mcp servers failed", "error", err)
				}
			}
		}
	}()
}

func (l *Loader) Registry() *Registry { return l.reg }

func (l *Loader) snapshot() []MCPServer {
	ptr := l.current.Load()
	if ptr == nil {
		return nil
	}
	return ptr.servers
}

func (l *Loader) reload() error {
	servers, raw, applied, err := l.loadRemoteOrFile()
	if err != nil {
		l.reportFailure(err)
		return err
	}
	l.current.Store(&snapshot{servers: servers})
	l.reg.Replace(servers)
	if applied {
		l.hasGood.Store(true)
		l.reportSuccess(raw)
	}
	return nil
}

func (l *Loader) loadRemoteOrFile() (servers []MCPServer, raw []byte, applied bool, err error) {
	if l.remote {
		body, code, getErr := gatewayinternal.HTTPGet(l.path)
		if getErr != nil {
			return nil, nil, false, getErr
		}
		if code == http.StatusNotFound {
			if l.hasGood.Load() {
				return nil, nil, false, configstatus.ErrRemote404Keep
			}
			return []MCPServer{}, nil, false, nil
		}
		if code < 200 || code >= 300 {
			return nil, nil, false, fmt.Errorf("remote mcp servers: http %d", code)
		}
		parsed, decErr := decodeMCPServers(body)
		if decErr != nil {
			return nil, nil, false, decErr
		}
		return parsed, body, true, nil
	}
	body, readErr := os.ReadFile(l.path)
	if readErr != nil {
		if errors.Is(readErr, os.ErrNotExist) {
			return []MCPServer{}, nil, false, nil
		}
		return nil, nil, false, readErr
	}
	parsed, decErr := decodeMCPServers(body)
	if decErr != nil {
		return nil, nil, false, decErr
	}
	return parsed, body, true, nil
}

func decodeMCPServers(body []byte) ([]MCPServer, error) {
	var parsed struct {
		Servers []MCPServer `json:"servers"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, err
	}
	if parsed.Servers == nil {
		parsed.Servers = []MCPServer{}
	}
	return parsed.Servers, nil
}

func (l *Loader) reportSuccess(raw []byte) {
	if l.status == nil {
		return
	}
	l.status.ReportSuccess(configstatus.DomainMCPServers, l.path, configstatus.HashBytes(raw), "")
}

func (l *Loader) reportFailure(err error) {
	if l.status == nil {
		return
	}
	l.status.ReportFailure(configstatus.DomainMCPServers, l.path, err)
}

// HostingEnabled reports whether MCP proxy routes should be registered.
func HostingEnabled() bool {
	v := strings.TrimSpace(os.Getenv("GATEWAY_MCP_HOSTING"))
	return strings.EqualFold(v, "on") || strings.EqualFold(v, "1") || strings.EqualFold(v, "true")
}
