package openai

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestChatCompletionRequestTemperaturePresenceRoundTrip(t *testing.T) {
	var explicitZero ChatCompletionRequest
	if err := json.Unmarshal([]byte(`{"model":"m","messages":[],"temperature":0}`), &explicitZero); err != nil {
		t.Fatal(err)
	}
	if explicitZero.Temperature == nil || *explicitZero.Temperature != 0 {
		t.Fatalf("explicit temperature=0 lost during decode: %#v", explicitZero.Temperature)
	}

	raw, err := json.Marshal(explicitZero)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"temperature":0`) {
		t.Fatalf("explicit temperature=0 lost during encode: %s", raw)
	}

	omitted, err := json.Marshal(ChatCompletionRequest{Model: "m"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(omitted), `"temperature"`) {
		t.Fatalf("omitted temperature should stay absent: %s", omitted)
	}
}
