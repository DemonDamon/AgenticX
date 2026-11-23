package configstatus

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/gatewayinternal"
)

const HeartbeatInterval = 30 * time.Second

func HeartbeatURL() string {
	return strings.TrimSpace(os.Getenv("GATEWAY_ADMIN_HEARTBEAT_URL"))
}

// SendHeartbeat posts the same JSON as GET /internal/config-status.
// An unconfigured URL is a no-op and returns nil.
func SendHeartbeat(reg *Registry, startedAt time.Time) error {
	target := HeartbeatURL()
	if !gatewayinternal.IsHTTPURL(target) {
		return nil
	}
	body, err := json.Marshal(BuildStatus(reg, startedAt))
	if err != nil {
		return err
	}
	code, err := gatewayinternal.HTTPPost(target, body)
	if err != nil {
		return err
	}
	if code < 200 || code >= 300 {
		return fmt.Errorf("heartbeat status %d", code)
	}
	return nil
}

// StartHeartbeat posts immediately and then every HeartbeatInterval until ctx is done.
// A missing URL does not start a goroutine. Send failures are logged and do not affect requests.
func StartHeartbeat(ctx context.Context, reg *Registry, startedAt time.Time, logger *slog.Logger) {
	if !gatewayinternal.IsHTTPURL(HeartbeatURL()) {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}
	go runHeartbeat(ctx, reg, startedAt, logger)
}

func runHeartbeat(ctx context.Context, reg *Registry, startedAt time.Time, logger *slog.Logger) {
	send := func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				logger.Warn("gateway heartbeat failed", "error", fmt.Sprint(recovered))
			}
		}()
		if err := SendHeartbeat(reg, startedAt); err != nil {
			logger.Warn("gateway heartbeat failed", "error", err)
		}
	}
	send()
	ticker := time.NewTicker(HeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			send()
		}
	}
}
