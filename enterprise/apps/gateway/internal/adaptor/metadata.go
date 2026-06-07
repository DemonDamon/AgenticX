package adaptor

import (
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/channel"
)

func metadataString(ch channel.Channel, keys ...string) string {
	if ch.Metadata == nil {
		return ""
	}
	for _, key := range keys {
		if v, ok := ch.Metadata[key].(string); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func bedrockRegion(ch channel.Channel) string {
	if r := strings.TrimSpace(ch.Region); r != "" {
		return r
	}
	return metadataString(ch, "region")
}

func bedrockCredentials(ch channel.Channel) (accessKey, secretKey string) {
	accessKey = metadataString(ch, "accessKeyId", "access_key_id")
	secretKey = metadataString(ch, "secretAccessKey", "secret_access_key")
	if accessKey != "" && secretKey != "" {
		return accessKey, secretKey
	}
	raw := strings.TrimSpace(ch.APIKey)
	if parts := strings.SplitN(raw, ":", 2); len(parts) == 2 {
		return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
	}
	return "", ""
}

func azureDeployment(ch channel.Channel, model string) string {
	if d := metadataString(ch, "deployment"); d != "" {
		return d
	}
	return modelForChannel(ch, model)
}

func azureAPIVersion(ch channel.Channel) string {
	if v := metadataString(ch, "apiVersion", "api_version"); v != "" {
		return v
	}
	return "2024-02-01"
}
