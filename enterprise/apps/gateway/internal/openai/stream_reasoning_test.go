package openai

import (
	"strings"
	"testing"
)

func TestNormalizeThinkTags(t *testing.T) {
	thinkOpen := "<" + "think" + ">"
	thinkClose := "<" + "/" + "think" + ">"
	got := NormalizeThinkTags(thinkOpen + "\nplan\n" + thinkClose + "\nanswer")
	want := "<think>\nplan\n</think>\nanswer"
	if got != want {
		t.Fatalf("unexpected normalize: %q", got)
	}
}

func TestStreamReasoningState_KimiStyleReasoningBeforeContent(t *testing.T) {
	var state StreamReasoningState
	got := state.MergeDelta("", "step1 ", "")
	if got != "<think>step1 " {
		t.Fatalf("unexpected first merge: %q", got)
	}
	got = state.MergeDelta(got, "step2", "")
	if got != "step2" {
		t.Fatalf("unexpected second merge: %q", got)
	}
	got = state.MergeDelta("<think>step1 step2", "", "final")
	if got != "</think>\nfinal" {
		t.Fatalf("unexpected content merge: %q", got)
	}
}

func TestStreamReasoningState_MiniMaxStyleReasoningAfterVisibleContent(t *testing.T) {
	var state StreamReasoningState
	accumulated := "<think>plan</think>\n\n```cpp\n"
	got := state.MergeDelta(accumulated, "#include <iostream>\n", "")
	if got != "<think>#include <iostream>\n" {
		t.Fatalf("unexpected post-fence merge: %q", got)
	}
	if tail := state.CloseOpenReasoning(); tail != "</think>" {
		t.Fatalf("unexpected reasoning tail: %q", tail)
	}
}

func TestStreamReasoningState_StripsRepeatedProviderCloseTags(t *testing.T) {
	var state StreamReasoningState
	var merged string
	for _, delta := range []string{
		"先判断用户意图。</think>",
		"准备执行联网搜索。</think>",
		"等待搜索结果。</think>",
	} {
		part := state.MergeDelta(merged, delta, "")
		merged += part
	}
	merged += state.CloseOpenReasoning()

	if strings.Count(merged, "<think>") != 1 || strings.Count(merged, "</think>") != 1 {
		t.Fatalf("reasoning markers must be balanced once, got %q", merged)
	}
	if strings.Contains(merged, "</think></think>") {
		t.Fatalf("provider close markers leaked into merged output: %q", merged)
	}
}

func TestStreamReasoningState_ClosesReasoningBeforeVisibleContentWithProviderMarker(t *testing.T) {
	var state StreamReasoningState
	first := state.MergeDelta("", "plan", "")
	second := state.MergeDelta(first, "", "</think>\nanswer")
	got := first + second
	if got != "<think>plan</think>\n\nanswer" {
		t.Fatalf("unexpected canonical boundary: %q", got)
	}
}

func TestStreamReasoningState_ResetsAfterRepeatedProviderBoundaryChunks(t *testing.T) {
	var state StreamReasoningState
	var merged string
	for _, reasoning := range []string{"判断意图", "准备检索", "等待结果"} {
		merged += state.MergeDelta(merged, reasoning, "</think>")
	}

	if strings.Count(merged, "<think>") != 3 || strings.Count(merged, "</think>") != 3 {
		t.Fatalf("every provider boundary must stay balanced, got %q", merged)
	}
	if tail := state.CloseOpenReasoning(); tail != "" {
		t.Fatalf("provider boundary must reset state, got trailing %q", tail)
	}
}

func TestComposeMessageContent(t *testing.T) {
	if got := ComposeMessageContent("answer", "thought"); got != "<think>thought</think>\nanswer" {
		t.Fatalf("unexpected compose: %q", got)
	}
}
