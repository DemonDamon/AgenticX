package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/routing"
	policyengine "github.com/agenticx/enterprise/policy-engine"
)

type retrievalAuditWriter struct {
	events []audit.Event
	err    error
}

func (w *retrievalAuditWriter) Write(event *audit.Event) error {
	if w.err != nil {
		return w.err
	}
	w.events = append(w.events, *event)
	return nil
}

func setPublicRetrievalSignature(t *testing.T, r *http.Request, raw []byte, bearer, token, nonce string, signedAt time.Time) {
	t.Helper()
	timestamp := signedAt.Unix()
	r.Header.Set("Authorization", bearer)
	r.Header.Set("X-AgenticX-Policy-Timestamp", strconv.FormatInt(timestamp, 10))
	r.Header.Set("X-AgenticX-Policy-Nonce", nonce)
	mac := hmac.New(sha256.New, []byte(token))
	_, _ = mac.Write([]byte("public-retrieval-v2\n" + bearer + "\n" + strconv.FormatInt(timestamp, 10) + "\n" + nonce + "\n"))
	_, _ = mac.Write(raw)
	r.Header.Set("X-AgenticX-Policy-Signature", hex.EncodeToString(mac.Sum(nil)))
}

func TestRetrievalPolicyTrustAndUserProtection(t *testing.T) {
	engine, err := policyengine.NewEngine([]policyengine.RulePackManifest{{Rules: []policyengine.Rule{
		{ID: "card", Kind: policyengine.RuleKindPII, PIIType: "bank-card", Action: policyengine.ActionBlock},
		{ID: "phone", Kind: policyengine.RuleKindPII, PIIType: "mobile", Action: policyengine.ActionRedact},
		{ID: "key", Kind: policyengine.RuleKindPII, PIIType: "api-key", Action: policyengine.ActionBlock},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	writer := &retrievalAuditWriter{}
	s := &Server{policy: engine, audit: writer}
	for _, tc := range []struct {
		name, user, text                              string
		signed, tamper, changeBearer, noToken, replay bool
		stale                                         bool
		blocked                                       bool
	}{
		{name: "public", user: "研究公开产品", text: "来源 https://example.org/123456789012345678", signed: true, blocked: true},
		{name: "unsigned", user: "研究公开产品", text: "123456789012345678", blocked: true},
		{name: "tampered", user: "研究公开产品", text: "123456789012345678", signed: true, tamper: true, blocked: true},
		{name: "other bearer", user: "研究公开产品", text: "123456789012345678", signed: true, changeBearer: true, blocked: true},
		{name: "no token", user: "研究公开产品", text: "123456789012345678", signed: true, noToken: true, blocked: true},
		{name: "stale", user: "研究公开产品", text: "123456789012345678", signed: true, stale: true, blocked: true},
		{name: "replay", user: "研究公开产品", text: "123456789012345678", signed: true, replay: true, blocked: true},
		{name: "empty user", text: "123456789012345678", signed: true, blocked: true},
		{name: "user card", user: "我的卡号 123456789012345678", text: "总结公开证据", signed: true, blocked: true},
		{name: "user phone", user: "我的手机号 13800138000", text: "问题 我的手机号 13800138000；来源电话 13900139000", signed: true},
		{name: "public secret", user: "研究公开产品", text: "网页中有 " + "sk-" + strings.Repeat("a", 20), signed: true, blocked: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resetPublicRetrievalNoncesForTest()
			writer.events = nil
			writer.err = nil
			t.Setenv("GATEWAY_INTERNAL_TOKEN", "test-internal-token")
			messages := []openai.ChatMessage{{Role: "user", Content: openai.NewStringContent(tc.user)}, {Role: "user", Content: openai.NewStringContent(tc.text)}}
			if tc.name == "empty user" {
				messages = []openai.ChatMessage{{Role: "system", Content: openai.NewStringContent("public retrieval prompt")}, {Role: "user", Content: openai.NewStringContent(tc.text)}}
			}
			context := &openai.PolicyContext{Source: "public-retrieval"}
			if strings.TrimSpace(tc.user) != "" {
				context.UserTextSHA256 = hashPublicRetrievalUserText(strings.Join([]string{tc.user, tc.text}, "\n\n"))
			}
			req := openai.ChatCompletionRequest{Messages: messages, PolicyContext: context}
			raw, _ := json.Marshal(req)
			r := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(string(raw)))
			r.Header.Set("Authorization", "Bearer test-user")
			if tc.signed {
				signedAt := time.Now()
				if tc.stale {
					signedAt = signedAt.Add(-publicRetrievalSignatureWindow - time.Second)
				}
				setPublicRetrievalSignature(t, r, raw, "Bearer test-user", "test-internal-token", "nonce-"+tc.name, signedAt)
			}
			if tc.tamper {
				raw = append(raw, ' ')
			}
			if tc.changeBearer {
				r.Header.Set("Authorization", "Bearer other-user")
			}
			if tc.noToken {
				t.Setenv("GATEWAY_INTERNAL_TOKEN", "")
				t.Setenv("GATEWAY_INTERNAL_TOKEN_FILE", "")
			}
			identity := requestIdentity{}
			if tc.replay {
				first := s.evaluateChatRequestPolicy(r, raw, &req, &identity)
				if !identity.PublicRetrieval {
					t.Fatalf("first signature must establish provenance: %+v", first)
				}
				req.PolicyContext = context
				identity = requestIdentity{}
			}
			result := s.evaluateChatRequestPolicy(r, raw, &req, &identity)
			if result.Blocked != tc.blocked {
				t.Fatalf("blocked=%v, expected=%v, hits=%+v", result.Blocked, tc.blocked, result.Hits)
			}
			if req.PolicyContext != nil {
				t.Fatal("provenance must not reach provider")
			}
			relayed, err := json.Marshal(req)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(relayed), "__policy_context") {
				t.Fatalf("policy context leaked to upstream body: %s", relayed)
			}
			if tc.name == "public" {
				if !identity.PublicRetrieval || len(result.Hits) != 2 || result.Hits[0].Action != policyengine.ActionBlock || result.Hits[1].Action != policyengine.ActionWarn {
					t.Fatalf("missing warning: %+v", result)
				}
				if !makeEvalContext(identity, "response").PublicRetrieval {
					t.Fatal("response must retain provenance")
				}
				if err := s.writePublicRetrievalWarnings(r, identity, routing.Decision{}, "test-model", "request", tc.text, result.Hits, time.Now()); err != nil {
					t.Fatal(err)
				}
				if len(writer.events) != 1 || writer.events[0].EventType != "policy_hit" || len(writer.events[0].PoliciesHit) != 1 || writer.events[0].PoliciesHit[0].Action != "warn" || writer.events[0].Digest.PromptHash != hashText(tc.text) {
					t.Fatalf("public warning missing from audit: %+v", writer.events)
				}
				response := s.evaluatePolicy(tc.text, makeEvalContext(identity, "response"))
				if !response.Blocked {
					t.Fatalf("response PII must not be downgraded: %+v", response)
				}
				if err := s.writePublicRetrievalWarnings(r, identity, routing.Decision{}, "test-model", "response", tc.text, response.Hits, time.Now()); err != nil {
					t.Fatal(err)
				}
				if len(writer.events) != 1 {
					t.Fatalf("response block hits must not be written as retrieval warnings: %+v", writer.events)
				}
			}
			if tc.name == "unsigned" {
				if err := s.writePublicRetrievalWarnings(r, identity, routing.Decision{}, "test-model", "request", tc.text, result.Hits, time.Now()); err != nil || len(writer.events) != 0 {
					t.Fatalf("untrusted request must not use retrieval warning audit: %v", err)
				}
			}
			if tc.name == "user phone" && (strings.Contains(openai.ContentText(req.Messages[0].Content), "13800138000") || strings.Contains(openai.ContentText(req.Messages[1].Content), "13800138000") || strings.Contains(openai.ContentText(req.Messages[1].Content), "13900139000")) {
				t.Fatalf("user phone redaction: first=%q second=%q", openai.ContentText(req.Messages[0].Content), openai.ContentText(req.Messages[1].Content))
			}
		})
	}
}

func TestRetrievalPolicyDerivesSignedUserTextFromPortalPromptShapes(t *testing.T) {
	engine, err := policyengine.NewEngine([]policyengine.RulePackManifest{{Rules: []policyengine.Rule{
		{ID: "card", Kind: policyengine.RuleKindPII, PIIType: "bank-card", Action: policyengine.ActionBlock},
		{ID: "phone", Kind: policyengine.RuleKindPII, PIIType: "mobile", Action: policyengine.ActionRedact},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{policy: engine, audit: &retrievalAuditWriter{}}
	for _, tc := range []struct {
		name       string
		userText   string
		messages   []openai.ChatMessage
		failClosed bool
	}{
		{
			name:     "planner single user",
			userText: "研究公开产品",
			messages: []openai.ChatMessage{
				{Role: "system", Content: openai.NewStringContent("你是研究规划助手。根据用户问题拆解研究路径。")},
				{Role: "user", Content: openai.NewStringContent("研究公开产品")},
			},
		},
		{
			name:     "clarifier single user",
			userText: "研究公开产品",
			messages: []openai.ChatMessage{
				{Role: "system", Content: openai.NewStringContent("你是调研开题助手。")},
				{Role: "user", Content: openai.NewStringContent("研究公开产品")},
			},
		},
		{
			name:     "plan revision single user",
			userText: "研究公开产品\n【计划对话】\n关注公开产品的价格",
			messages: []openai.ChatMessage{
				{Role: "system", Content: openai.NewStringContent("你是研究规划助手。")},
				{Role: "user", Content: openai.NewStringContent("研究公开产品\n【计划对话】\n关注公开产品的价格")},
			},
		},
		{
			name:       "repair single user",
			failClosed: true,
			userText:   "研究公开产品",
			messages: []openai.ChatMessage{
				{Role: "system", Content: openai.NewStringContent("你是报告章节修复助手。")},
				{Role: "user", Content: openai.NewStringContent("章节：研究公开产品\n证据包：\n来源 123456789012345678")},
			},
		},
		{
			name:       "outline topic marker",
			failClosed: true,
			userText:   "研究公开产品",
			messages: []openai.ChatMessage{
				{Role: "system", Content: openai.NewStringContent("你是报告大纲规划助手。")},
				{Role: "user", Content: openai.NewStringContent("主题：研究公开产品\n\n证据包：\n来源 123456789012345678")},
			},
		},
		{
			name:       "section report title marker",
			failClosed: true,
			userText:   "研究公开产品",
			messages: []openai.ChatMessage{
				{Role: "system", Content: openai.NewStringContent("你是报告章节写作助手。")},
				{Role: "user", Content: openai.NewStringContent("报告标题：研究公开产品\n当前章节（第 1/3）：核心结论\n证据包：\n来源 123456789012345678")},
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resetPublicRetrievalNoncesForTest()
			t.Setenv("GATEWAY_INTERNAL_TOKEN", "test-internal-token")
			req := openai.ChatCompletionRequest{
				Messages: tc.messages,
				PolicyContext: &openai.PolicyContext{
					Source:         "public-retrieval",
					UserTextSHA256: hashPublicRetrievalUserText(tc.userText),
				},
			}
			raw, _ := json.Marshal(req)
			r := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(string(raw)))
			setPublicRetrievalSignature(t, r, raw, "Bearer test-user", "test-internal-token", "nonce-"+tc.name, time.Now())
			identity := requestIdentity{}
			result := s.evaluateChatRequestPolicy(r, raw, &req, &identity)
			if result.Blocked != tc.failClosed {
				t.Fatalf("blocked=%v want=%v for %s", result.Blocked, tc.failClosed, tc.name)
			}
			if identity.PublicRetrieval == tc.failClosed {
				t.Fatalf("unexpected public retrieval identity for %s", tc.name)
			}
		})
	}
}

func TestRetrievalPolicyRejectsSignedContextWhenUserHashDoesNotMatchMessages(t *testing.T) {
	engine, err := policyengine.NewEngine([]policyengine.RulePackManifest{{Rules: []policyengine.Rule{
		{ID: "card", Kind: policyengine.RuleKindPII, PIIType: "bank-card", Action: policyengine.ActionBlock},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{policy: engine, audit: &retrievalAuditWriter{}}
	resetPublicRetrievalNoncesForTest()
	t.Setenv("GATEWAY_INTERNAL_TOKEN", "test-internal-token")
	req := openai.ChatCompletionRequest{
		Messages: []openai.ChatMessage{
			{Role: "system", Content: openai.NewStringContent("你是报告大纲规划助手。")},
			{Role: "user", Content: openai.NewStringContent("主题：研究公开产品\n\n证据包：\n来源 123456789012345678")},
		},
		PolicyContext: &openai.PolicyContext{
			Source:         "public-retrieval",
			UserTextSHA256: hashPublicRetrievalUserText("其他用户问题"),
		},
	}
	raw, _ := json.Marshal(req)
	r := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(string(raw)))
	setPublicRetrievalSignature(t, r, raw, "Bearer test-user", "test-internal-token", "nonce-mismatch", time.Now())
	identity := requestIdentity{}
	result := s.evaluateChatRequestPolicy(r, raw, &req, &identity)
	if !result.Blocked || identity.PublicRetrieval {
		t.Fatalf("hash mismatch must fall back to ordinary policy: result=%+v identity=%+v", result, identity)
	}
}

func TestRetrievalPolicyMultimodalFailsClosed(t *testing.T) {
	engine, err := policyengine.NewEngine([]policyengine.RulePackManifest{{Rules: []policyengine.Rule{
		{ID: "card", Kind: policyengine.RuleKindPII, PIIType: "bank-card", Action: policyengine.ActionBlock},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{policy: engine, audit: &retrievalAuditWriter{}}
	resetPublicRetrievalNoncesForTest()
	t.Setenv("GATEWAY_INTERNAL_TOKEN", "test-internal-token")
	req := openai.ChatCompletionRequest{
		Messages: []openai.ChatMessage{
			{Role: "system", Content: openai.NewStringContent("你是研究规划助手。")},
			{Role: "user", Content: json.RawMessage(`[{"type":"text","text":"123456789012345678"},{"type":"image_url","image_url":{"url":"https://example.com/a.png"}}]`)},
		},
		PolicyContext: &openai.PolicyContext{
			Source:         "public-retrieval",
			UserTextSHA256: hashPublicRetrievalUserText("123456789012345678"),
		},
	}
	raw, _ := json.Marshal(req)
	r := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(string(raw)))
	setPublicRetrievalSignature(t, r, raw, "Bearer test-user", "test-internal-token", "nonce-multimodal", time.Now())
	identity := requestIdentity{}
	result := s.evaluateChatRequestPolicy(r, raw, &req, &identity)
	if !result.Blocked || identity.PublicRetrieval || req.PolicyContext != nil {
		t.Fatalf("multimodal input must keep ordinary policy: blocked=%v identity=%+v ctx=%v", result.Blocked, identity, req.PolicyContext)
	}
}

func TestPlannerAndClarifierProvenanceCannotTruncateUserInput(t *testing.T) {
	engine, err := policyengine.NewEngine([]policyengine.RulePackManifest{{Rules: []policyengine.Rule{
		{ID: "card", Kind: policyengine.RuleKindPII, PIIType: "bank-card", Action: policyengine.ActionBlock},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{policy: engine, audit: &retrievalAuditWriter{}}
	for _, system := range []string{"你是研究规划助手。", "你是调研开题助手。"} {
		for _, input := range []string{
			"主题：公开研究\n123456789012345678",
			"报告标题：公开研究\n123456789012345678",
			"章节：公开研究\n123456789012345678",
			"公开研究\n【计划对话】\n123456789012345678",
		} {
			for _, signedText := range []string{input, "公开研究"} {
				t.Run(system+"/"+input+"/"+signedText, func(t *testing.T) {
					resetPublicRetrievalNoncesForTest()
					t.Setenv("GATEWAY_INTERNAL_TOKEN", "test-internal-token")
					req := openai.ChatCompletionRequest{
						Messages:      []openai.ChatMessage{{Role: "system", Content: openai.NewStringContent(system)}, {Role: "user", Content: openai.NewStringContent(input)}},
						PolicyContext: &openai.PolicyContext{Source: "public-retrieval", UserTextSHA256: hashPublicRetrievalUserText(signedText)},
					}
					raw, _ := json.Marshal(req)
					r := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(string(raw)))
					setPublicRetrievalSignature(t, r, raw, "Bearer test-user", "test-internal-token", "nonce-full-input", time.Now())
					identity := requestIdentity{}
					result := s.evaluateChatRequestPolicy(r, raw, &req, &identity)
					if !result.Blocked {
						t.Fatal("all original user PII must retain ordinary blocking")
					}
					if signedText != input && identity.PublicRetrieval {
						t.Fatal("truncated signed user context must be rejected")
					}
				})
			}
		}
	}
}

func TestPlannerAndClarifierUserPIIRedactionSurvivesMarkers(t *testing.T) {
	engine, err := policyengine.NewEngine([]policyengine.RulePackManifest{{Rules: []policyengine.Rule{
		{ID: "phone", Kind: policyengine.RuleKindPII, PIIType: "mobile", Action: policyengine.ActionRedact},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{policy: engine, audit: &retrievalAuditWriter{}}
	input := "主题：公开研究\n13800138000"
	for _, system := range []string{"你是研究规划助手。", "你是调研开题助手。"} {
		for _, signedText := range []string{input, "公开研究"} {
			t.Run(system+"/"+signedText, func(t *testing.T) {
				resetPublicRetrievalNoncesForTest()
				t.Setenv("GATEWAY_INTERNAL_TOKEN", "test-internal-token")
				req := openai.ChatCompletionRequest{
					Messages:      []openai.ChatMessage{{Role: "system", Content: openai.NewStringContent(system)}, {Role: "user", Content: openai.NewStringContent(input)}},
					PolicyContext: &openai.PolicyContext{Source: "public-retrieval", UserTextSHA256: hashPublicRetrievalUserText(signedText)},
				}
				raw, _ := json.Marshal(req)
				r := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(string(raw)))
				setPublicRetrievalSignature(t, r, raw, "Bearer test-user", "test-internal-token", "nonce-marker-phone", time.Now())
				identity := requestIdentity{}
				result := s.evaluateChatRequestPolicy(r, raw, &req, &identity)
				if signedText == input {
					if strings.Contains(openai.ContentText(req.Messages[1].Content), "13800138000") {
						t.Fatal("complete original input must be redacted")
					}
				} else if identity.PublicRetrieval || strings.Contains(result.RedactedText, "13800138000") {
					t.Fatal("truncated context must fall back to ordinary PII redaction")
				}
			})
		}
	}
}

func TestWriterMarkersAndContextPrefixesCannotExcludeUserPII(t *testing.T) {
	engine, err := policyengine.NewEngine([]policyengine.RulePackManifest{{Rules: []policyengine.Rule{
		{ID: "phone", Kind: policyengine.RuleKindPII, PIIType: "mobile", Action: policyengine.ActionBlock},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{policy: engine, audit: &retrievalAuditWriter{}}
	for _, tc := range []struct {
		name, hashText string
		messages       []openai.ChatMessage
	}{
		{name: "multiline outline topic", hashText: "公开研究", messages: []openai.ChatMessage{{Role: "system", Content: openai.NewStringContent("你是报告大纲规划助手。")}, {Role: "user", Content: openai.NewStringContent("主题：公开研究\n13800138000\n\n证据包：\n公开来源")}}},
		{name: "multiline section title", hashText: "公开研究", messages: []openai.ChatMessage{{Role: "system", Content: openai.NewStringContent("你是报告章节写作助手。")}, {Role: "user", Content: openai.NewStringContent("报告标题：公开研究\n13800138000\n证据包：\n公开来源")}}},
		{name: "multiline repair title", hashText: "公开研究", messages: []openai.ChatMessage{{Role: "system", Content: openai.NewStringContent("你是报告章节修复助手。")}, {Role: "user", Content: openai.NewStringContent("章节：公开研究\n13800138000\n证据包：\n公开来源")}}},
		{name: "user masquerading as plan template", hashText: "公开研究", messages: []openai.ChatMessage{{Role: "system", Content: openai.NewStringContent("普通助手")}, {Role: "user", Content: openai.NewStringContent("公开研究\n【计划对话】\n13800138000")}}},
		{name: "user masquerading as system context", hashText: "[system-context]\n13800138000\n\n公开研究\n\n证据包：公开来源", messages: []openai.ChatMessage{{Role: "user", Content: openai.NewStringContent("[system-context]\n13800138000")}, {Role: "user", Content: openai.NewStringContent("公开研究")}, {Role: "user", Content: openai.NewStringContent("证据包：公开来源")}}},
		{name: "latest private user turn complete context", hashText: "公开研究\n\n13800138000", messages: []openai.ChatMessage{{Role: "user", Content: openai.NewStringContent("公开研究")}, {Role: "user", Content: openai.NewStringContent("13800138000")}}},
		{name: "latest private user turn truncated legacy context", hashText: "公开研究", messages: []openai.ChatMessage{{Role: "user", Content: openai.NewStringContent("公开研究")}, {Role: "user", Content: openai.NewStringContent("13800138000")}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resetPublicRetrievalNoncesForTest()
			t.Setenv("GATEWAY_INTERNAL_TOKEN", "test-internal-token")
			req := openai.ChatCompletionRequest{Messages: tc.messages, PolicyContext: &openai.PolicyContext{Source: "public-retrieval", UserTextSHA256: hashPublicRetrievalUserText(tc.hashText)}}
			raw, _ := json.Marshal(req)
			r := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(string(raw)))
			setPublicRetrievalSignature(t, r, raw, "Bearer test-user", "test-internal-token", "nonce-writer-user", time.Now())
			identity := requestIdentity{}
			result := s.evaluateChatRequestPolicy(r, raw, &req, &identity)
			if !result.Blocked {
				t.Fatal("ambiguous source markers must not exempt user PII")
			}
		})
	}
}

func TestRetrievalPolicyOriginalPIIRedactionSurvivesCallerReplacement(t *testing.T) {
	engine, err := policyengine.NewEngine([]policyengine.RulePackManifest{{Rules: []policyengine.Rule{
		{ID: "phone", Kind: policyengine.RuleKindPII, PIIType: "mobile", Action: policyengine.ActionRedact},
		{ID: "keyword", Kind: policyengine.RuleKindKeyword, Keywords: []string{"notice"}, Action: policyengine.ActionRedact},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{policy: engine, audit: &retrievalAuditWriter{}}
	resetPublicRetrievalNoncesForTest()
	t.Setenv("GATEWAY_INTERNAL_TOKEN", "test-internal-token")
	input := "13800138000 notice"
	req := openai.ChatCompletionRequest{
		Messages:      []openai.ChatMessage{{Role: "system", Content: openai.NewStringContent("你是研究规划助手。")}, {Role: "user", Content: openai.NewStringContent(input)}},
		PolicyContext: &openai.PolicyContext{Source: "public-retrieval", UserTextSHA256: hashPublicRetrievalUserText(input)},
	}
	raw, _ := json.Marshal(req)
	r := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(string(raw)))
	setPublicRetrievalSignature(t, r, raw, "Bearer test-user", "test-internal-token", "nonce-caller-redaction", time.Now())
	identity := requestIdentity{}
	result := s.evaluateChatRequestPolicy(r, raw, &req, &identity)
	// This is the actual replacement sequence used by chat handlers.
	if result.RedactedText != input {
		req.Messages = replaceLastUserMessageContent(req.Messages, result.RedactedText)
	}
	final := openai.ContentText(req.Messages[1].Content)
	if strings.Contains(final, "13800138000") || strings.Contains(final, "notice") {
		t.Fatalf("caller replacement reintroduced redacted input: %q", final)
	}
}
