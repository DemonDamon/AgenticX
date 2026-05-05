# Policy Snapshot Runbook

## 适用场景

- 策略发布后需要确认 Gateway 是否已同步新版本。
- 某次发布误伤，需要回滚到历史版本。
- 排查策略权限是否符合预期（编辑/发布/禁用分权）。

## 快照文件

- 默认路径：`/runtime/admin/policy-snapshot.json`
- 生产 compose：`GATEWAY_POLICY_SNAPSHOT_FILE=/runtime/admin/policy-snapshot.json`

快速检查：

```bash
ls -l /runtime/admin/policy-snapshot.json
```

## 发布后验证

1. 在 Admin Console 执行发布（`/api/policy/publish`）。
2. 确认 `policy_publish_events` 新增一条 `status=published` 记录。
3. 检查快照文件 mtime 是否更新。
4. 访问 Gateway `GET /healthz`，确认服务健康。
5. 使用命中样本回归（request/response 各一条）。

## 回滚步骤

1. 打开发布记录列表（`/api/policy/publishes`）。
2. 对目标版本执行 `POST /api/policy/publishes/{id}/rollback`。
3. 系统会：
   - 将目标事件标记为 `rolled_back`；
   - 生成一个新的 `published` 事件（版本号递增）；
   - 重写快照文件并触发 Gateway 热更新。
4. 重新执行样本回归，确认行为恢复。

## 权限矩阵（最小集）

- `policy:read`：查看规则包、规则、发布记录、规则测试。
- `policy:create`：新建规则包/规则。
- `policy:update`：编辑规则包/规则。
- `policy:disable`：启停规则包、禁用规则。
- `policy:publish`：发布与回滚。
- `policy:delete`：删除自定义规则包/规则。

推荐系统角色：

- `policy_admin`：读/增/改/删/禁用（无发布）
- `policy_publisher`：读 + 发布/回滚（无编辑）
- `policy_auditor`：只读

## 常见故障

- **发布成功但网关未生效**
  - 检查快照文件路径是否一致（Admin 与 Gateway 共用挂载目录）。
  - 检查 Gateway 日志是否出现 `policy engine reloaded`。
- **规则测试与真实命中不一致**
  - 检查 `applies_to.stages`、`clientTypes`、`userExcludeIds`。
  - 检查请求 JWT 中 `tenantId/deptId/roleCodes/clientType` 是否齐全。
- **回滚后仍旧命中新规则**
  - 确认回滚生成了新 `published` 事件，而非仅修改旧记录。
  - 确认快照文件 mtime 已变化并触发 reload。
