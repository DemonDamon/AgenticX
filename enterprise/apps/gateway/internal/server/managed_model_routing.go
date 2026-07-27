package server

import (
	"errors"
	"strings"

	gatewayauth "github.com/agenticx/enterprise/gateway/internal/auth"
)

var (
	errManagedModelCandidate = errors.New("managed model must be provider/model")
	errModelNotAssigned      = errors.New("model is not assigned to this account")
)

func resolveManagedModelCandidate(bodyModel, headerProvider string) (providerID, modelName string, err error) {
	bodyModel = strings.TrimSpace(bodyModel)
	headerProvider = strings.TrimSpace(headerProvider)
	if bodyModel == "" {
		return "", "", errManagedModelCandidate
	}
	if idx := strings.Index(bodyModel, "/"); idx >= 0 {
		providerID = strings.TrimSpace(bodyModel[:idx])
		modelName = strings.TrimSpace(bodyModel[idx+1:])
		if providerID == "" || modelName == "" {
			return "", "", errManagedModelCandidate
		}
		if headerProvider != "" && headerProvider != providerID {
			return "", "", errManagedModelCandidate
		}
		return providerID, modelName, nil
	}
	if headerProvider == "" {
		return "", "", errManagedModelCandidate
	}
	return headerProvider, bodyModel, nil
}

func managedIdentityFromRequest(identity requestIdentity) gatewayauth.ManagedModelIdentity {
	return gatewayauth.ManagedModelIdentity{
		TenantID:  identity.TenantID,
		UserID:    identity.UserID,
		UserEmail: identity.UserEmail,
		DeptID:    identity.DepartmentID,
	}
}

func auditClientType(identity requestIdentity) string {
	if strings.TrimSpace(identity.ClientType) != "" {
		return identity.ClientType
	}
	return "web-portal"
}
