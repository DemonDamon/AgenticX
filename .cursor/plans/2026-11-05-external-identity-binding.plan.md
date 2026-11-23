# 外部身份绑定与受控邮箱关联

Planned-with: gpt-6.1-sol
Suggested-Impl-Model: gpt-6.1-sol
Status: 已实施并完成单项及组合验证

## 根因与范围
主线 a680b0663 的 Portal loginWithOidcClaims 每次按 email 选账号，subject 仅审计；管理端 authenticateAdminConsoleViaOidc 同样仅邮箱匹配。OIDC claims 缺少映射邮箱对应的 emailVerified，且 externalId 可配置为可变业务属性。仅修改认证、身份仓储、双方言 schema/migration、事务接线和相关测试，不修改密码登录、用户/角色授权策略、SAML 瞬态身份语义或前端布局。

## 实施落点与行为
1. auth/services/oidc-claims.ts：增加 emailVerified:boolean|null；默认 email 只读取 email_verified，自定义 email 必须显式映射其验证路径；稳定身份使用已验证 ID token 原始 sub，不使用 externalId 映射，不折叠大小写或前后空白。
2. auth/services/sso-protocol-handler.ts 和 sso-sign-in-policy.ts：贯穿验证状态；OIDC handler 通过 verified sub 生成 identity；portal/admin callback 透传 verified claims 的 sub 和验证状态。保留 AuthStrategyRegistry/SAML 入口。
3. db-schema/src/{schema,mysql-schema}/sso-identity-links.ts：tenant/provider/issuer/subject 身份的 SHA-256 长度安全索引，保留原始字段并逐字节校验；同 tenant/provider/user 只能有一个稳定身份。复合用户外键阻止跨租户连接。追加 PG 0075 / MySQL 0049 迁移并更新 journal 和 inventory/parity 测试。
4. iam-core/database/tenant-iam-transaction.ts：以租户行锁串行首次关联，AsyncLocalStorage 让现有 PG/MySQL 仓储使用同一事务；正常请求没有事务上下文时行为保持不变。嵌套同租户复用，跨租户/已结束上下文拒绝。锁等待有界，MySQL session timeout 恢复失败销毁连接。
5. iam-core/repos/sso-identity-links.ts 与 mysql 对应仓储：find/bind 接口，插入冲突不覆盖，回读并校验唯一归属。repo 返回稳定 userId；登陆查询结果必须匹配该ID。软删除账号的绑定仍占位，不能回退邮箱找另一个用户。
6. portal/auth-runtime.ts：先绑定→按不可变userID读原用户，已有绑定纯读不排队等待租户写锁；仅首次且 emailVerified===true 才邮箱懒关联/JIT；昂贵哈希在事务外生成后重新检查所有条件。禁用/锁定拒绝；JIT、角色赋值与绑定同事务。SAML 保持原邮箱/JIT行为。
7. admin/admin-pg-auth.ts：增加不可变身份输入，已有绑定按userID纯读，首次关联加事务；首次受控邮箱匹配，仍必须预开户且具有 admin:enter；绑定与检查在同事务，已有绑定邮箱变化仍返回原账号。

## 可执行验收
- claims/protocol/sign-in-policy 单测：true/false/null，自定义邮箱不能继承标准 email_verified，sub 不受externalId配置影响，缺失/非法sub拒绝。
- Portal/admin runtime 测试：未验证首次关联拒绝，绑定后邮箱变化不换账号，未验证已有绑定不锁死，禁用/删除账号不回退，双回调一条绑定，SAML原行为。
- sso-identity-links.db.test.ts：只读取 SSO_TEST_POSTGRES_URL/SSO_TEST_MYSQL_URL，PG/MySQL 均运行。大小写/issuer/租户隔离、冲突不改绑、同provider不同subject不能抢同user、事务回滚和并发首次绑定。
- schema parity/inventory 和涉及 auth/iam-core 的 typecheck。

## 迁移与回滚
新增表空启动，旧账号验证后懒绑定，无批量猜测。向前迁移先于应用发布；应用回滚时保留表，不能自动删除绑定。人工解绑/issuer迁移不在本PR范围。仅明确配置的IdP已验证邮箱可首次关联，不新增默认未验证例外。

## 实施收口
- 为 JIT 增加专用 insert-only 插入，不复用可能在MySQL邮件唯一键冲突时更新旧账号的通用 upsert；已有账号状态、密码和角色保持权威。
- OIDC 不再在身份事务后调用聊天历史的账号快照 UPSERT，避免覆盖解锁后管理员的禁用/密码变更；SAML保留原路径。
- 新增真实DB“持有无关首次绑定写锁时，4个已绑定身份并发读取仍完成”验收；租户写锁仅首次关联/JIT使用，首次关联的低频串行化是本PR的保守取舍。
- 完整应用 typecheck 与主线HEAD同依赖快照逐条对照：Portal 33项/Admin 12项既有错误，本变更未新增；auth/iam-core/db-schema包 typecheck 独立通过。验证结果以最终命令报告为准。

## 最终验证记录
- 35个定向测试文件143项通过；真实两种数据库18项通过，包含已绑定并发读取不等待无关首次绑定事务。
- 两端完整迁移链通过，auth/iam-core/db-schema三包typecheck通过。
- 完整Portal/Admin类型检查分别为33/12项错误，与原始HEAD相同依赖快照逐条一致，零新增。
- 与权限基础组合时保留显式system/sso和bootstrap actor；组合测试201项及令牌兼容22项通过，组合后的类型检查仍零新增。
