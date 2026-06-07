package adaptor

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestSignRequestDeterministic(t *testing.T) {
	req, err := http.NewRequest(http.MethodPost, "https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-haiku-20240307-v1:0/converse", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	payload := []byte(`{"messages":[{"role":"user","content":[{"text":"hi"}]}]}`)
	fixed := time.Date(2024, 6, 1, 12, 0, 0, 0, time.UTC)
	cred := sigV4Credentials{
		AccessKey: "TESTACCESSKEYID01",
		SecretKey: "testSecretKeyValue0123456789",
		Region:    "us-east-1",
		Service:   "bedrock",
	}
	if err := signRequest(req, cred, payload, fixed); err != nil {
		t.Fatal(err)
	}
	auth := req.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "AWS4-HMAC-SHA256 Credential=TESTACCESSKEYID01/20240601/us-east-1/bedrock/aws4_request") {
		t.Fatalf("unexpected credential scope: %s", auth)
	}
	if !strings.Contains(auth, "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date") {
		t.Fatalf("unexpected signed headers: %s", auth)
	}
	// Deterministic re-sign
	req2, _ := http.NewRequest(http.MethodPost, req.URL.String(), nil)
	req2.Header.Set("Content-Type", "application/json")
	if err := signRequest(req2, cred, payload, fixed); err != nil {
		t.Fatal(err)
	}
	if req2.Header.Get("Authorization") != auth {
		t.Fatalf("signature not deterministic:\n%s\n%s", auth, req2.Header.Get("Authorization"))
	}
	if req.Header.Get("X-Amz-Date") != "20240601T120000Z" {
		t.Fatalf("unexpected amz date: %s", req.Header.Get("X-Amz-Date"))
	}
}
