package server

import (
	"os"
	"strings"
)

func inboundEnabled(envKey string) bool {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv(envKey)))
	if raw == "" {
		return true
	}
	switch raw {
	case "0", "false", "off", "no":
		return false
	default:
		return true
	}
}

func claudeInboundEnabled() bool  { return inboundEnabled("GATEWAY_INBOUND_CLAUDE") }
func geminiInboundEnabled() bool  { return inboundEnabled("GATEWAY_INBOUND_GEMINI") }
func responsesInboundEnabled() bool { return inboundEnabled("GATEWAY_INBOUND_RESPONSES") }
