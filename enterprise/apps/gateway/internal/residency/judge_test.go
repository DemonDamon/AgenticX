package residency

import "testing"

func TestIsCrossBorder_cnToUs(t *testing.T) {
	if !IsCrossBorder("cn", "us") {
		t.Fatal("expected cn->us cross border")
	}
}

func TestIsCrossBorder_emptySameDomain(t *testing.T) {
	if IsCrossBorder("", "us") || IsCrossBorder("cn", "") {
		t.Fatal("empty region should not trigger cross border")
	}
	if IsCrossBorder("cn", "cn") {
		t.Fatal("same region should not cross border")
	}
}

func TestJudge_blockAction(t *testing.T) {
	res := Judge("cn", "us", TenantPolicy{CrossBorderAction: ActionBlock})
	if !res.CrossBorder || !res.Blocked {
		t.Fatalf("expected blocked cross border, got %+v", res)
	}
	if res.ResidencyRule != "cross_border:block" {
		t.Fatalf("unexpected rule: %s", res.ResidencyRule)
	}
}

func TestJudge_requireApproval(t *testing.T) {
	res := Judge("cn", "us", TenantPolicy{CrossBorderAction: ActionRequireApproval})
	if !res.CrossBorder || !res.PendingApproval {
		t.Fatalf("expected pending approval, got %+v", res)
	}
}

func TestJudge_sameDomainNoOp(t *testing.T) {
	res := Judge("cn", "cn", TenantPolicy{CrossBorderAction: ActionBlock})
	if res.CrossBorder || res.Blocked {
		t.Fatalf("same domain must not block, got %+v", res)
	}
}
