package server

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/billing"
	"github.com/agenticx/enterprise/gateway/internal/config"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/quota"
	"github.com/agenticx/enterprise/gateway/internal/routing"
	policyengine "github.com/agenticx/enterprise/policy-engine"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
)

type leaseDiscardAudit struct{}

func (leaseDiscardAudit) Write(*audit.Event) error { return nil }

type leaseProcessProvider struct{ upstream string }

func (leaseProcessProvider) Complete(context.Context, openai.ChatCompletionRequest, routing.Decision) (openai.ChatCompletionResponse, error) {
	return openai.ChatCompletionResponse{}, fmt.Errorf("stream-only fixture")
}
func (leaseProcessProvider) Embeddings(context.Context, openai.EmbeddingRequest, routing.Decision) (openai.EmbeddingResponse, error) {
	return openai.EmbeddingResponse{}, fmt.Errorf("stream-only fixture")
}
func (p leaseProcessProvider) Stream(ctx context.Context, _ openai.ChatCompletionRequest, _ routing.Decision, push func(openai.StreamChunk) error) error {
	if err := push(openai.StreamChunk{Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{Content: "held"}}}}); err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.upstream, nil)
	if err != nil {
		return err
	}
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	_, err = io.Copy(io.Discard, response.Body)
	return err
}

// This test function becomes a real, independently initialized HTTP Gateway
// process only when explicitly selected by the parent persistence fixture.
func TestLeaseGatewayHelperProcess(t *testing.T) {
	if os.Getenv("AGX_LEASE_HELPER_PROCESS") != "1" {
		return
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	limiter := quota.NewSharedRateLimiter(os.Getenv("GATEWAY_LEASE_TEST_REDIS_URL"))
	if os.Getenv("AGX_LEASE_SHORT_TEST") == "1" {
		_ = limiter.Close()
		var err error
		limiter, err = quota.NewSharedRateLimiterWithLeaseOptions(os.Getenv("GATEWAY_LEASE_TEST_REDIS_URL"), quota.ConcurrencyLeaseOptions{TTL: 2 * time.Second, SafetyMargin: 200 * time.Millisecond, RenewInterval: 300 * time.Millisecond, RetryInterval: 50 * time.Millisecond, OperationTimeout: 50 * time.Millisecond})
		if err != nil {
			t.Fatal(err)
		}
	}
	tracker := quota.NewTrackerWithRateLimiter(os.Getenv("AGX_LEASE_QUOTA_FILE"), os.Getenv("AGX_LEASE_USAGE_FILE"), nil, limiter)
	s := &Server{logger: logger, provider: leaseProcessProvider{upstream: os.Getenv("AGX_LEASE_UPSTREAM")}, quotaTracker: tracker, billingService: billing.NewService(tracker), policy: &policyengine.Engine{}, metering: discardUsageSink{}, audit: leaseDiscardAudit{}, decider: routing.NewDecider(config.Config{DefaultRoute: "third-party"})}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(os.Getenv("AGX_LEASE_READY_FILE"), []byte("http://"+listener.Addr().String()), 0600); err != nil {
		t.Fatal(err)
	}
	if err = http.Serve(listener, s.Router()); err != nil {
		t.Fatal(err)
	}
}

func TestSharedConcurrencyAcrossGatewayProcessesRealRedis(t *testing.T) {
	redisURL := os.Getenv("GATEWAY_LEASE_TEST_REDIS_URL")
	if redisURL == "" {
		t.Skip("requires disposable Redis service")
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	pub, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	publicPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pub}))
	tenant := fmt.Sprintf("lease-%d", time.Now().UnixNano())
	user := tenant + "-user"
	claims := accessClaims{TenantID: tenant, UserID: user, Type: "access", Scopes: []string{"workspace:chat"}, RegisteredClaims: jwt.RegisteredClaims{Issuer: "agenticx-enterprise-web-portal", Audience: jwt.ClaimStrings{"agenticx-web-users"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}}
	token, err := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	release := make(chan struct{})
	released := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
			_, _ = w.Write([]byte("done"))
		case <-r.Context().Done():
		}
	}))
	defer func() {
		if !released {
			close(release)
		}
		upstream.Close()
	}()
	var gateways []string
	for i := 0; i < 2; i++ {
		gateways = append(gateways, startLeaseGatewayProcess(t, redisURL, upstream.URL, publicPEM, user, false))
	}

	type result struct {
		response *http.Response
		err      error
	}
	results := make(chan result, 12)
	start := make(chan struct{})
	client := &http.Client{Timeout: 8 * time.Second}
	for i := 0; i < 12; i++ {
		go func(index int) {
			<-start
			r, e := http.NewRequest(http.MethodPost, gateways[index%2]+"/v1/chat/completions", strings.NewReader(`{"model":"m","stream":true,"messages":[{"role":"user","content":"synthetic overlap"}]}`))
			if e != nil {
				results <- result{err: e}
				return
			}
			r.Header.Set("Authorization", "Bearer "+token)
			r.Header.Set("Content-Type", "application/json")
			resp, e := client.Do(r)
			results <- result{resp, e}
		}(i)
	}
	close(start)
	allowed, denied := 0, 0
	var active []*http.Response
	for i := 0; i < 12; i++ {
		select {
		case r := <-results:
			if r.err != nil {
				t.Fatal(r.err)
			}
			switch r.response.StatusCode {
			case http.StatusOK:
				allowed++
				active = append(active, r.response)
			case http.StatusTooManyRequests:
				denied++
				_ = r.response.Body.Close()
			default:
				b, _ := io.ReadAll(r.response.Body)
				_ = r.response.Body.Close()
				t.Fatalf("unexpected status %d: %s", r.response.StatusCode, b)
			}
		case <-time.After(10 * time.Second):
			t.Fatal("overlapping requests did not reach headers")
		}
	}
	close(release)
	released = true
	for _, response := range active {
		_, err = io.Copy(io.Discard, response.Body)
		_ = response.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
	}
	if allowed != 3 || denied != 9 {
		t.Fatalf("two gateway processes: admitted=%d denied=%d want3/9", allowed, denied)
	}
	t.Logf("two independent Gateway processes with shared real service: admitted=%d rejected=%d", allowed, denied)
}

func startLeaseGatewayProcess(t *testing.T, redisURL, upstreamURL, publicPEM, user string, short bool) string {
	address, _ := startLeaseGatewayProcessHandle(t, redisURL, upstreamURL, publicPEM, user, short)
	return address
}
func startLeaseGatewayProcessHandle(t *testing.T, redisURL, upstreamURL, publicPEM, user string, short bool) (string, *exec.Cmd) {
	t.Helper()
	d := t.TempDir()
	quotaFile := filepath.Join(d, "quotas.json")
	ready := filepath.Join(d, "ready")
	if err := os.WriteFile(quotaFile, []byte(fmt.Sprintf(`{"users":{%q:{"maxConcurrency":3,"action":"block"}}}`, user)), 0600); err != nil {
		t.Fatal(err)
	}
	logFile, err := os.Create(filepath.Join(d, "process.log"))
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestLeaseGatewayHelperProcess$", "-test.timeout=45s")
	cmd.Env = append(os.Environ(), "AGX_LEASE_HELPER_PROCESS=1", "GATEWAY_LEASE_TEST_REDIS_URL="+redisURL, "AGX_LEASE_QUOTA_FILE="+quotaFile, "AGX_LEASE_USAGE_FILE="+filepath.Join(d, "usage.json"), "AGX_LEASE_READY_FILE="+ready, "AGX_LEASE_UPSTREAM="+upstreamURL, "AUTH_JWT_PUBLIC_KEY="+publicPEM, "GATEWAY_REQUEST_TIMEOUT=10s", "GATEWAY_CHANNEL_REGISTRY=off", "GATEWAY_QUOTA_POOL=off", "GATEWAY_TOKEN_WINDOW_QUOTA=off", "GATEWAY_REQUEST_COUNT_QUOTA=off", "GATEWAY_REMOTE_QUOTA_CONFIG_URL=", "GATEWAY_REMOTE_BUDGET_CONFIG_URL=", "GATEWAY_BUDGET_BACKEND=", "GATEWAY_BUDGET_CONFIG_FILE="+filepath.Join(d, "none-budget.json"), "GATEWAY_BUDGET_USAGE_FILE="+filepath.Join(d, "budget-usage.json"))
	if short {
		cmd.Env = append(cmd.Env, "AGX_LEASE_SHORT_TEST=1")
	}
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait(); _ = logFile.Close() })
	deadline := time.Now().Add(10 * time.Second)
	for {
		b, e := os.ReadFile(ready)
		if e == nil {
			return string(b), cmd
		}
		if time.Now().After(deadline) {
			t.Fatal("independent gateway failed to initialize")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestConcurrencyHTTPStreamPauseAndLossRealRedis(t *testing.T) {
	raw := os.Getenv("GATEWAY_LEASE_TEST_REDIS_URL")
	if raw == "" {
		t.Skip("requires disposable Redis service")
	}
	if os.Getenv("GATEWAY_LEASE_TEST_ALLOW_PAUSE") != "1" {
		t.Fatal("requires explicit disposable-service pause opt-in")
	}
	options, err := redis.ParseURL(raw)
	if err != nil {
		t.Fatal(err)
	}
	control := redis.NewClient(options)
	defer control.Close()
	for _, mode := range []string{"short_pause", "long_pause", "process_crash"} {
		t.Run(mode, func(t *testing.T) {
			key, err := rsa.GenerateKey(rand.Reader, 2048)
			if err != nil {
				t.Fatal(err)
			}
			pub, _ := x509.MarshalPKIXPublicKey(&key.PublicKey)
			publicPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pub}))
			tenant := fmt.Sprintf("held-%d", time.Now().UnixNano())
			user := tenant + "-user"
			claims := accessClaims{TenantID: tenant, UserID: user, Type: "access", Scopes: []string{"workspace:chat"}, RegisteredClaims: jwt.RegisteredClaims{Issuer: "agenticx-enterprise-web-portal", Audience: jwt.ClaimStrings{"agenticx-web-users"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}}
			token, err := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(key)
			if err != nil {
				t.Fatal(err)
			}
			release := make(chan struct{})
			cancelled := make(chan struct{}, 12)
			released := false
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				select {
				case <-release:
					_, _ = w.Write([]byte("done"))
				case <-r.Context().Done():
					cancelled <- struct{}{}
				}
			}))
			defer func() {
				if !released {
					close(release)
				}
				upstream.Close()
			}()
			gateway, process := startLeaseGatewayProcessHandle(t, raw, upstream.URL, publicPEM, user, true)
			if mode == "process_crash" {
				testLeaseProcessCrash(t, process, gateway, raw, upstream.URL, publicPEM, user, token, release, &released)
				released = true
				return
			}
			request, err := http.NewRequest(http.MethodPost, gateway+"/v1/chat/completions", strings.NewReader(`{"model":"m","stream":true,"messages":[{"role":"user","content":"synthetic long flow"}]}`))
			if err != nil {
				t.Fatal(err)
			}
			request.Header.Set("Authorization", "Bearer "+token)
			request.Header.Set("Content-Type", "application/json")
			client := &http.Client{Timeout: 8 * time.Second}
			response, err := client.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			if response.StatusCode != http.StatusOK {
				t.Fatal("stream failed before pause", response.StatusCode)
			}
			started := time.Now()
			pause := 500
			if mode == "long_pause" {
				pause = 3000
			}
			if err = control.Do(context.Background(), "CLIENT", "PAUSE", pause, "ALL").Err(); err != nil {
				t.Fatal(err)
			}
			if mode == "short_pause" {
				time.Sleep(2500 * time.Millisecond)
				close(release)
				released = true
			}
			body, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatal(err)
			}
			if mode == "short_pause" {
				if !strings.Contains(string(body), "[DONE]") || strings.Contains(string(body), "50302") {
					t.Fatalf("short-pause HTTP stream failed: %s", body)
				}
			} else {
				if !strings.Contains(string(body), "50302") || strings.Contains(string(body), "agenticx_usage") {
					t.Fatalf("long-pause HTTP stream succeeded or wrong code: %s", body)
				}
				if time.Since(started) > 4*time.Second {
					t.Fatal("stream waited beyond conservative deadline")
				}
				select {
				case <-cancelled:
				case <-time.After(time.Second):
					t.Fatal("upstream request context not cancelled")
				}
				time.Sleep(1300 * time.Millisecond)
			}
		})
	}
}

func testLeaseProcessCrash(t *testing.T, process *exec.Cmd, ownerAddress, redisURL, upstreamURL, publicPEM, user, token string, release chan struct{}, released *bool) {
	t.Helper()
	survivor := startLeaseGatewayProcess(t, redisURL, upstreamURL, publicPEM, user, true)
	client := &http.Client{Timeout: 8 * time.Second}
	call := func(address string) *http.Response {
		r, e := http.NewRequest(http.MethodPost, address+"/v1/chat/completions", strings.NewReader(`{"model":"m","stream":true,"messages":[{"role":"user","content":"crash fixture"}]}`))
		if e != nil {
			t.Fatal(e)
		}
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("Content-Type", "application/json")
		response, e := client.Do(r)
		if e != nil {
			t.Fatal(e)
		}
		return response
	}
	var occupied []*http.Response
	for i := 0; i < 3; i++ {
		r := call(ownerAddress)
		if r.StatusCode != http.StatusOK {
			t.Fatal("owner failed to acquire", r.StatusCode)
		}
		occupied = append(occupied, r)
	}
	killed := time.Now()
	if err := process.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	blocked := call(survivor)
	_ = blocked.Body.Close()
	if blocked.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("crashed owner capacity bypassed before TTL: %d", blocked.StatusCode)
	}
	if time.Since(killed) > 1500*time.Millisecond {
		t.Fatal("pre-expiry assertion ran after its intended window")
	}
	time.Sleep(2200 * time.Millisecond)
	recovered := call(survivor)
	defer recovered.Body.Close()
	if recovered.StatusCode != http.StatusOK {
		t.Fatal("crashed leases not reclaimed", recovered.StatusCode)
	}
	close(release)
	*released = true
	body, err := io.ReadAll(recovered.Body)
	if err != nil || !strings.Contains(string(body), "[DONE]") {
		t.Fatal("survivor failed after TTL", err, string(body))
	}
	for _, r := range occupied {
		_ = r.Body.Close()
	}
	t.Log("Gateway owner killed with three occupied slots; surviving process rejected before TTL and admitted after expiry")
}
