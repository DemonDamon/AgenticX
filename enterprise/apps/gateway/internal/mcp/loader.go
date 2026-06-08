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
	path   string
	remote bool
	logger *slog.Logger
	reg    *Registry
	current atomic.Pointer[snapshot]
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
	servers, err := l.loadRemoteOrFile()
	if err != nil {
		return err
	}
	l.current.Store(&snapshot{servers: servers})
	l.reg.Replace(servers)
	return nil
}

func (l *Loader) loadRemoteOrFile() ([]MCPServer, error) {
	var bytes []byte
	var err error
	if l.remote {
		var code int
		bytes, code, err = gatewayinternal.HTTPGet(l.path)
		if err != nil {
			return nil, err
		}
		if code == http.StatusNotFound {
			return []MCPServer{}, nil
		}
		if code < 200 || code >= 300 {
			return nil, fmt.Errorf("remote mcp servers: http %d", code)
		}
	} else {
		bytes, err = os.ReadFile(l.path)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return []MCPServer{}, nil
			}
			return nil, err
		}
	}
	var parsed struct {
		Servers []MCPServer `json:"servers"`
	}
	if err := json.Unmarshal(bytes, &parsed); err != nil {
		return nil, err
	}
	if parsed.Servers == nil {
		parsed.Servers = []MCPServer{}
	}
	return parsed.Servers, nil
}

// HostingEnabled reports whether MCP proxy routes should be registered.
func HostingEnabled() bool {
	v := strings.TrimSpace(os.Getenv("GATEWAY_MCP_HOSTING"))
	return strings.EqualFold(v, "on") || strings.EqualFold(v, "1") || strings.EqualFold(v, "true")
}
