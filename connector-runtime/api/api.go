// Package api 提供连接器网关核心的内嵌公共面：宿主（独立进程形态 / 企业网关
// 内嵌形态）通过本包复用同一核心——连接器定义模型、目录投影、SSRF 守护执行器、
// AES-GCM 凭据加密，以及存储/策略/审计的接口缝隙与 5 个发现型工具的程序化调度。
//
// 本包是 core 对外的唯一公共面；internal/* 仍为独立进程形态私有装配。
package api

import (
	"context"

	"github.com/agenticx/connector-runtime/internal/audit"
	"github.com/agenticx/connector-runtime/internal/catalog"
	"github.com/agenticx/connector-runtime/internal/connection"
	"github.com/agenticx/connector-runtime/internal/executor"
	"github.com/agenticx/connector-runtime/internal/model"
	"github.com/agenticx/connector-runtime/internal/policy"
	"github.com/agenticx/connector-runtime/internal/secret"
)

// ---- 连接器定义模型（JSON 定义是目录与执行的唯一事实源） ----

type (
	Connector  = model.Connector
	Action     = model.Action
	AuthSpec   = model.AuthSpec
	AuthType   = model.AuthType
	APIKeyAuth = model.APIKeyAuth
	HTTPAction = model.HTTPAction
)

const (
	AuthNone   = model.AuthNone
	AuthAPIKey = model.AuthAPIKey
)

// ParseConnector 从 JSON 解析连接器定义并校验。
func ParseConnector(data []byte) (*Connector, error) { return model.Parse(data) }

// ---- 目录投影（搜索/发现） ----

type (
	AppSummary    = catalog.AppSummary
	ActionSummary = catalog.ActionSummary
	CatalogStore  = catalog.Store
)

// NewCatalog 构建目录；连接器 id 重复视为错误。
func NewCatalog(connectors []*Connector) (*CatalogStore, error) { return catalog.New(connectors) }

// ---- 动作执行（SSRF 守护 + 错误语义） ----

type (
	Executor   = executor.Executor
	ExecOptions = executor.Options
	ExecResult  = executor.Result
	ExecError   = executor.ExecError
)

// 执行错误码（对齐 400/502/504 语义）。
const (
	CodeInputError    = executor.CodeInputError
	CodeSSRFForbidden = executor.CodeSSRFForbidden
	CodeUpstreamError = executor.CodeUpstreamError
	CodeTimeout       = executor.CodeTimeout
)

// NewExecutor 构造执行器（构造后可复用，并发安全）。
func NewExecutor(opts ExecOptions) *Executor { return executor.New(opts) }

// ---- 连接（凭据不进 Agent，明文仅在网关进程内） ----

type (
	ConnectionProjection = connection.Projection
	ConnectionSecret     = connection.Secret
)

// ---- 策略 ----

// PolicyDecision 评估结论。Code 为空表示放行。
type PolicyDecision = policy.Decision

// ---- 审计 ----

type (
	AuditEntry = audit.Entry
)

// 执行状态。
const (
	AuditStatusOK     = audit.StatusOK
	AuditStatusError  = audit.StatusError
	AuditStatusDenied = audit.StatusDenied
)

// ---- 凭据加密 ----

type Cipher = secret.Cipher

// 主密钥长度（AES-256）。
const MasterKeySize = secret.KeySize

// NewCipher 用 32 字节主密钥构造 AES-GCM 加解密器。
func NewCipher(key []byte) (*Cipher, error) { return secret.NewCipher(key) }

// GenerateMasterKey 生成随机主密钥。
func GenerateMasterKey() []byte { return secret.GenerateKey() }

// ---- 装配缝隙（宿主实现差异层） ----

// Connections 连接存储缝隙：独立形态为本地加密文件，企业形态为 PG 加密列。
// 实现必须并发安全；Reveal 解出的明文凭据仅在网关进程内使用。
type Connections interface {
	List(ctx context.Context) []ConnectionProjection
	Get(ctx context.Context, id string) (ConnectionProjection, bool)
	Reveal(ctx context.Context, id string) (ConnectionSecret, error)
}

// ActionPolicy 动作级策略缝隙：独立形态为 glob allow/block 规则，
// 企业形态由宿主策略引擎评估后适配。nil 策略视为放行。
type ActionPolicy interface {
	Evaluate(actionID string) PolicyDecision
}

// AuditSink 执行审计缝隙：独立形态为 JSONL 文件；企业形态复用网关审计
// 事件维度（可通过 nil 跳过，改由宿主从 CallResult.Exec 提取）。
type AuditSink interface {
	Log(entry AuditEntry) error
}
