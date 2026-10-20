package openai

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestPolicyContextRoundTripStripsBeforeRelay(t *testing.T) {
	raw := []byte(`{"model":"m","messages":[{"role":"user","content":"hi"}],"__policy_context":{"source":"public-retrieval","user_text_sha256":"abc"}}`)
	var req ChatCompletionRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		t.Fatal(err)
	}
	if req.PolicyContext == nil || req.PolicyContext.Source != "public-retrieval" || req.PolicyContext.UserTextSHA256 != "abc" {
		t.Fatalf("policy context: %+v", req.PolicyContext)
	}
	req.PolicyContext = nil
	out, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(out, []byte("__policy_context")) || bytes.Contains(out, []byte("user_text_sha256")) {
		t.Fatalf("relayed body still carries policy context: %s", out)
	}
}
