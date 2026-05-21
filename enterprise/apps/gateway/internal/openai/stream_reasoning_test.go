package openai

import "testing"

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
	if got != "#include <iostream>\n" {
		t.Fatalf("unexpected post-fence merge: %q", got)
	}
}

func TestComposeMessageContent(t *testing.T) {
	if got := ComposeMessageContent("answer", "thought"); got != "<think>thought</think>\nanswer" {
		t.Fatalf("unexpected compose: %q", got)
	}
}
