package adaptor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/openai"
)

// AzureAdaptor calls Azure OpenAI deployment endpoints with api-key auth.
type AzureAdaptor struct {
	httpClient *http.Client
	streamCfg  StreamConfig
}

func NewAzureAdaptor(opts ...OpenAIOption) *AzureAdaptor {
	a := &OpenAIAdaptor{streamCfg: StreamConfigFromEnv()}
	for _, opt := range opts {
		if opt != nil {
			opt(a)
		}
	}
	return &AzureAdaptor{
		httpClient: &http.Client{Timeout: 120 * time.Second},
		streamCfg:  a.streamCfg,
	}
}

func (a *AzureAdaptor) Name() string { return "azure" }

func (a *AzureAdaptor) Complete(
	ctx context.Context,
	req openai.ChatCompletionRequest,
	ch channel.Channel,
) (openai.ChatCompletionResponse, error) {
	endpoint, apiKey, err := azurePrepare(ch)
	if err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	targetURL, err := azureChatURL(endpoint, ch, req.Model, false)
	if err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	upstream := req
	upstream.Stream = false
	if strings.TrimSpace(upstream.Model) == "" {
		upstream.Model = modelForChannel(ch, req.Model)
	}
	body, err := json.Marshal(upstream)
	if err != nil {
		return openai.ChatCompletionResponse{}, fmt.Errorf("marshal azure request: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(body))
	if err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	setAzureHeaders(httpReq, apiKey)
	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return openai.ChatCompletionResponse{}, fmt.Errorf("azure upstream failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return openai.ChatCompletionResponse{}, readUpstreamError(resp)
	}
	var decoded openai.ChatCompletionResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return openai.ChatCompletionResponse{}, fmt.Errorf("decode azure response: %w", err)
	}
	if strings.TrimSpace(decoded.Model) == "" {
		decoded.Model = nonEmpty(azureDeployment(ch, req.Model), req.Model)
	}
	return decoded, nil
}

func (a *AzureAdaptor) Stream(
	ctx context.Context,
	req openai.ChatCompletionRequest,
	ch channel.Channel,
	push StreamPush,
) error {
	endpoint, apiKey, err := azurePrepare(ch)
	if err != nil {
		return err
	}
	targetURL, err := azureChatURL(endpoint, ch, req.Model, false)
	if err != nil {
		return err
	}
	upstream := req
	upstream.Stream = true
	if strings.TrimSpace(upstream.Model) == "" {
		upstream.Model = modelForChannel(ch, req.Model)
	}
	body, err := json.Marshal(upstream)
	if err != nil {
		return fmt.Errorf("marshal azure stream request: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	setAzureHeaders(httpReq, apiKey)
	httpReq.Header.Set("Accept", "text/event-stream")
	streamClient := *a.httpClient
	streamClient.Timeout = 0
	resp, err := streamClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("azure stream failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return readUpstreamError(resp)
	}
	return parseSSEStream(resp.Body, a.streamCfg, push)
}

func (a *AzureAdaptor) Embeddings(
	ctx context.Context,
	req openai.EmbeddingRequest,
	ch channel.Channel,
) (openai.EmbeddingResponse, error) {
	endpoint, apiKey, err := azurePrepare(ch)
	if err != nil {
		return openai.EmbeddingResponse{}, err
	}
	deployment := azureDeployment(ch, req.Model)
	targetURL, err := azureEmbeddingsURL(endpoint, deployment, azureAPIVersion(ch))
	if err != nil {
		return openai.EmbeddingResponse{}, err
	}
	if strings.TrimSpace(req.Model) == "" {
		req.Model = deployment
	}
	body, err := json.Marshal(req)
	if err != nil {
		return openai.EmbeddingResponse{}, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(body))
	if err != nil {
		return openai.EmbeddingResponse{}, err
	}
	setAzureHeaders(httpReq, apiKey)
	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return openai.EmbeddingResponse{}, fmt.Errorf("azure embeddings failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return openai.EmbeddingResponse{}, readUpstreamError(resp)
	}
	var decoded openai.EmbeddingResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return openai.EmbeddingResponse{}, err
	}
	return decoded, nil
}

func azurePrepare(ch channel.Channel) (endpoint, apiKey string, err error) {
	endpoint = strings.TrimRight(strings.TrimSpace(ch.BaseURL), "/")
	if endpoint == "" {
		return "", "", fmt.Errorf("channel missing base_url")
	}
	apiKey = strings.TrimSpace(ch.APIKey)
	if apiKey == "" {
		return "", "", fmt.Errorf("channel missing api key")
	}
	return endpoint, apiKey, nil
}

func azureChatURL(base string, ch channel.Channel, model string, _ bool) (string, error) {
	deployment := azureDeployment(ch, model)
	apiVersion := azureAPIVersion(ch)
	u, err := url.Parse(base)
	if err != nil {
		return "", fmt.Errorf("invalid azure base_url: %w", err)
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/openai/deployments/" + url.PathEscape(deployment) + "/chat/completions"
	q := u.Query()
	q.Set("api-version", apiVersion)
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func azureEmbeddingsURL(base, deployment, apiVersion string) (string, error) {
	u, err := url.Parse(base)
	if err != nil {
		return "", err
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/openai/deployments/" + url.PathEscape(deployment) + "/embeddings"
	q := u.Query()
	q.Set("api-version", apiVersion)
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func setAzureHeaders(req *http.Request, apiKey string) {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("api-key", apiKey)
}
