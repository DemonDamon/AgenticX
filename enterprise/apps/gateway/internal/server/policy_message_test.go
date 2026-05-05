package server

import (
	"testing"

	policyengine "github.com/agenticx/enterprise/policy-engine"
)

func TestPolicyMessageWithHitsIncludesRuleMessage(t *testing.T) {
	got := policyMessageWithHits("请求触发合规拦截", []policyengine.HitEvent{
		{RuleID: "000001", Message: "检测医疗关键词关键词"},
	})

	want := "请求触发合规拦截：检测医疗关键词关键词（命中策略: 000001）"
	if got != want {
		t.Fatalf("unexpected message, got=%q want=%q", got, want)
	}
}

func TestPolicyMessageWithHitsDeduplicatesIDsAndMessages(t *testing.T) {
	got := policyMessageWithHits("请求触发合规拦截", []policyengine.HitEvent{
		{RuleID: "000001", Message: "检测医疗关键词关键词"},
		{RuleID: "000001", Message: "检测医疗关键词关键词"},
		{RuleID: "000002", Message: "禁止低俗话题"},
	})

	want := "请求触发合规拦截：检测医疗关键词关键词；禁止低俗话题（命中策略: 000001, 000002）"
	if got != want {
		t.Fatalf("unexpected message, got=%q want=%q", got, want)
	}
}
