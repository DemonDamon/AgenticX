# Edge Agent 供应链审计

## 依赖原则

1. **标准库优先**：能用标准库解决绝不引入第三方
2. **活跃维护**：依赖项最近 12 个月须有 commit
3. **审计友好**：每个依赖需要一句话说清「为何引入」
4. **版本锁定**：`go.sum` 必须提交并被 CI 校验
5. **License 兼容**：仅允许 MIT / BSD / Apache-2.0 / ISC

## 当前依赖（白名单）

_Skeleton 阶段，暂无运行时依赖_

未来引入需遵循：

| 包 | 用途 | 理由 | License | 审核人 |
|---|---|---|---|---|
| _例：github.com/go-chi/chi/v5_ | HTTP 路由 | 标准库 http 够用则优先 | MIT | Damon |

## CI 门禁

```yaml
# .github/workflows/security.yml 骨架
- name: Vuln check
  run: govulncheck ./...

- name: License scan
  run: go-licenses check ./... --disallowed_types=forbidden,restricted

- name: SBOM generation
  run: syft . -o cyclonedx-json > edge-agent.sbom.json

- name: Signature verify on release
  run: cosign verify-blob --signature edge-agent.sig edge-agent
```

## 引入新依赖 Checklist

在 PR 描述里填写：

- [ ] 为何必须引入（标准库为何不行）？
- [ ] 活跃度：最近 3 次 commit 日期 + star 数 + 维护者数量
- [ ] License 类型
- [ ] 已运行 `govulncheck` 无高危
- [ ] 已在本文件白名单登记
