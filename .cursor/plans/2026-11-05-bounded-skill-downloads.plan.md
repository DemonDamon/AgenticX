# 受控的远程技能下载

Planned-with: gpt-6.1-sol
Suggested-Impl-Model: gpt-6.1-sol

## 范围与证据

基线 a680b0663。`enterprise/apps/web-portal/src/lib/enterprise-skill-bundle.ts::loadSkillBody` 已限制 HTTPS、主机名单、重定向和超时，但 `response.text().slice` 全量读取后才截断，连接未绑定校验的 DNS 地址，`enterprise-skill-context.ts::applyAssignedSkillPrompt` 没有校验 capability 中已有的 bundleDigest。

## 实施

1. 新增同目录 `skill-bundle-transport.ts`：用 Node HTTPS 原生请求，解析并校验全部地址，lookup 仅返回已校验地址；保持原 hostname 的 TLS/SNI 与 Host，禁用连接复用，禁止跳转。仅明确配置的内网源可用私有地址，link-local/metadata 始终拒绝。
2. `loadSkillBody` 保留 `Promise<string|null>` 语义；DNS、TLS、响应头、body 共用 2500ms 总期限；读取中累计原始字节，超过 24000 字节立即销毁流；非 2xx 或异常返回 null。摘要存在时按原始 body 校验 SHA-256（支持裸 hex 与 sha256:hex），验证后才解码/剥 frontmatter；没有摘要的历史记录保留兼容。
3. `applyAssignedSkillPrompt` 传入已有摘要；不更改技能 catalog、分发、权限或归档格式。

## 验收

- `enterprise-skill-bundle.test.ts` 覆盖名单、凭据/fragment、摘要与 frontmatter、非成功响应、字节大小、deadline。
- 新增真实 TLS transport 测试，合成证书仅用于本机测试；验证 lookup 固定、SNI/Host 未改、无效证书仍失败、重定向不跟随、超限及慢流中断、混合 DNS 地址拒绝、IPv6/mapped 私网地址、内网开关与 metadata 拒绝。
- 运行相关 Vitest 和定向 TypeScript 检查；不引入额外网络依赖、不读生产配置。

## 验证结果

真实本机TLS、地址策略、摘要到prompt入口及既有prompt回归：3个文件42项通过。覆盖私网开启仍拒绝已知IPv6元数据地址、慢body中止后连接关闭、DNS迟到回答不创建socket。传输代码定向TypeScript检查通过。联合分支三包类型检查通过；整应用的既有类型错误单独保留，不写成全绿。
