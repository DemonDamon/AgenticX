package metering

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/gatewayinternal"
)

const defaultPricingRefreshInterval = 10 * time.Second

// PricingLoader keeps a PricingTable in sync with local file and optional remote snapshot.
type PricingLoader struct {
	localPath string
	remoteURL string
	table     *PricingTable
	local     *PricingTable

	mu            sync.Mutex
	remoteFetched time.Time
	remoteRaw     []byte
	remoteVersion string
}

func NewPricingLoader(localPath string) (*PricingLoader, error) {
	local, err := LoadPricingTable(localPath)
	if err != nil {
		return nil, err
	}
	table := &PricingTable{models: make(map[string][]ModelPricing), defaultP: defaultModelPricing()}
	if localPath != "" {
		if raw, readErr := os.ReadFile(localPath); readErr == nil {
			_ = table.ApplySnapshot(raw, local.Version())
		}
	}
	table.SetLocalFallback(local)

	loader := &PricingLoader{
		localPath: localPath,
		remoteURL: strings.TrimSpace(os.Getenv("GATEWAY_REMOTE_PRICING_CONFIG_URL")),
		table:     table,
		local:     local,
	}
	loader.refreshRemote()
	return loader, nil
}

// Table returns the active pricing table (remote snapshot when available, else local file).
func (l *PricingLoader) Table() *PricingTable {
	l.refreshRemote()
	return l.table
}

func (l *PricingLoader) refreshRemote() {
	u := strings.TrimSpace(l.remoteURL)
	if u == "" || !gatewayinternal.IsHTTPURL(u) {
		l.useLocal()
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if !l.remoteFetched.IsZero() && time.Since(l.remoteFetched) < defaultPricingRefreshInterval {
		return
	}
	raw, code, err := gatewayinternal.HTTPGet(u)
	if err != nil {
		log.Printf("[pricing] remote config fetch failed url=%s err=%v", u, err)
		l.fallbackLocked()
		return
	}
	if code == http.StatusNotFound {
		l.remoteRaw = nil
		l.remoteVersion = ""
		l.remoteFetched = time.Now()
		l.fallbackLocked()
		return
	}
	if code < 200 || code >= 300 {
		log.Printf("[pricing] remote config bad status url=%s code=%d", u, code)
		l.fallbackLocked()
		return
	}
	version := extractPricingVersion(raw)
	if err := l.table.ApplySnapshot(raw, version); err != nil {
		log.Printf("[pricing] remote config parse failed err=%v", err)
		l.fallbackLocked()
		return
	}
	l.remoteRaw = append([]byte(nil), raw...)
	l.remoteVersion = version
	l.remoteFetched = time.Now()
}

func (l *PricingLoader) useLocal() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.fallbackLocked()
}

func (l *PricingLoader) fallbackLocked() {
	if len(l.remoteRaw) > 0 {
		_ = l.table.ApplySnapshot(l.remoteRaw, l.remoteVersion)
		return
	}
	if raw := l.readLocalBytes(); len(raw) > 0 {
		_ = l.table.ApplySnapshot(raw, l.local.Version())
	}
}

func (l *PricingLoader) readLocalBytes() []byte {
	if l.localPath == "" {
		return nil
	}
	raw, err := os.ReadFile(l.localPath)
	if err != nil {
		return nil
	}
	return raw
}

func extractPricingVersion(raw []byte) string {
	var h struct {
		Version   string `json:"version"`
		UpdatedAt string `json:"updatedAt"`
	}
	if err := json.Unmarshal(raw, &h); err != nil {
		return "remote"
	}
	if strings.TrimSpace(h.Version) != "" {
		return strings.TrimSpace(h.Version)
	}
	if strings.TrimSpace(h.UpdatedAt) != "" {
		return "snapshot:" + strings.TrimSpace(h.UpdatedAt)
	}
	return "remote"
}
