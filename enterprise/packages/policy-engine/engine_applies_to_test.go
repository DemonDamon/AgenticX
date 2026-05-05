package policyengine

import "testing"

func TestEngineEvaluateWithContextAppliesToMatrix(t *testing.T) {
	engine, err := NewEngine([]RulePackManifest{
		{
			Name: "pack-a",
			Rules: []Rule{
				{
					ID:       "rule-sales-only",
					Kind:     RuleKindKeyword,
					Action:   ActionBlock,
					Keywords: []string{"内幕交易"},
					AppliesTo: &AppliesTo{
						Version:        1,
						DepartmentIDs:  []string{"dept-sales"},
						RoleCodes:      []string{"sales"},
						UserExcludeIDs: []string{"vip-user"},
						ClientTypes:    []string{"web-portal"},
						Stages:         []string{"request"},
					},
				},
				{
					ID:       "rule-whitelist-user",
					Kind:     RuleKindKeyword,
					Action:   ActionWarn,
					Keywords: []string{"资金流水"},
					AppliesTo: &AppliesTo{
						Version:     1,
						UserIDs:     []string{"white-user"},
						RoleCodes:   []string{"*"},
						ClientTypes: []string{"*"},
						Stages:      []string{"request", "response"},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("new engine: %v", err)
	}

	matched := engine.EvaluateWithContext("这段内容包含内幕交易", EvalContext{
		TenantID:   "tenant-a",
		DeptIDs:    []string{"dept-sales"},
		RoleCodes:  []string{"sales"},
		UserID:     "normal-user",
		ClientType: "web-portal",
		Stage:      "request",
	})
	if !matched.Blocked {
		t.Fatalf("expected matched context to be blocked")
	}

	notMatchedClient := engine.EvaluateWithContext("这段内容包含内幕交易", EvalContext{
		TenantID:   "tenant-a",
		DeptIDs:    []string{"dept-sales"},
		RoleCodes:  []string{"sales"},
		UserID:     "normal-user",
		ClientType: "desktop",
		Stage:      "request",
	})
	if notMatchedClient.Blocked {
		t.Fatalf("expected client_type mismatch to skip rule")
	}

	notMatchedStage := engine.EvaluateWithContext("这段内容包含内幕交易", EvalContext{
		TenantID:   "tenant-a",
		DeptIDs:    []string{"dept-sales"},
		RoleCodes:  []string{"sales"},
		UserID:     "normal-user",
		ClientType: "web-portal",
		Stage:      "response",
	})
	if notMatchedStage.Blocked {
		t.Fatalf("expected stage mismatch to skip rule")
	}

	excludedUser := engine.EvaluateWithContext("这段内容包含内幕交易", EvalContext{
		TenantID:   "tenant-a",
		DeptIDs:    []string{"dept-sales"},
		RoleCodes:  []string{"sales"},
		UserID:     "vip-user",
		ClientType: "web-portal",
		Stage:      "request",
	})
	if excludedUser.Blocked {
		t.Fatalf("expected userExcludeIds to bypass rule")
	}

	whitelisted := engine.EvaluateWithContext("请核验资金流水", EvalContext{
		TenantID:   "tenant-a",
		DeptIDs:    []string{"dept-any"},
		RoleCodes:  []string{"staff"},
		UserID:     "white-user",
		ClientType: "desktop",
		Stage:      "response",
	})
	if len(whitelisted.Hits) == 0 {
		t.Fatalf("expected whitelist user to hit warn rule")
	}

	nonWhitelisted := engine.EvaluateWithContext("请核验资金流水", EvalContext{
		TenantID:   "tenant-a",
		DeptIDs:    []string{"dept-any"},
		RoleCodes:  []string{"staff"},
		UserID:     "other-user",
		ClientType: "desktop",
		Stage:      "response",
	})
	if len(nonWhitelisted.Hits) != 0 {
		t.Fatalf("expected non-whitelist user to skip warn rule")
	}
}
