# acp-08 Near 设置页凭证库

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: `.cursor/plans/2026-10-14-acp-master.plan.md`
Depends: acp-02（Studio `GET /api/credentials`、`PUT/DELETE /api/credentials/{name}`）

## 目标

Near 设置里新增「凭证」页：集中录入密钥，复制 `${cred:NAME}` 引用填到模型供应商或 MCP 配置里。页面永远不显示已保存的密钥值。

## 根因与证据

- 设置导航 `TAB_DEFS` 在 `desktop/src/components/SettingsPanel.tsx`（约 1089 行），现有 tab：`account, general, provider, mcp, connectors, tools, skills, commands, knowledge, data_sources, memory, automation, voice, favorites, server, security`；tab id 类型与别名在 `desktop/src/components/settings-tab.ts`（或同名工具文件，`SETTINGS_TAB_IDS`）。
- 没有凭证页；Provider 与 MCP 的密钥明文写入配置文件。
- acp-02 提供的接口返回 `{ ok, credentials: [{ name, description, updated_at, referenced_by }] }`，不返回 value。

## 改动

1. `settings-tab.ts`：`SETTINGS_TAB_IDS` 增加 `"credentials"`。
2. `SettingsPanel.tsx`：`TAB_DEFS` 在 `mcp` 之后插入 `{ id: "credentials", label: "凭证", icon: KeyRound }`（`lucide-react`），并新增 `tab === "credentials"` 渲染分支。
3. 新建 `desktop/src/components/settings/credentials/CredentialsTab.tsx`：
   - 调用本机 Studio 的方式照抄同目录其它设置页（例如 knowledge 或 security 下的组件）里已有的写法，不新增 IPC。
   - 列表：名称、描述、被引用位置（如「MCP · github」「模型 · openai」）、更新时间；每行「复制引用」（复制 `${cred:NAME}`，按钮旁短暂显示「已复制」）、「编辑」、「删除」。
   - 新建/编辑弹层：名称（新建时可填，编辑只读，前端校验 `^[A-Z][A-Z0-9_]{1,63}$`，非法时输入框下方提示）、值（`type="password"`，编辑时留空表示不修改，占位文字「留空则保持原值」）、描述。底部「取消」紧挨「保存」在其左侧；保存失败保持弹层并显示接口错误；成功 toast。
   - 删除：应用内主题化确认弹层；若该凭证有引用，正文写明「以下配置引用了它，删除后这些配置会连接失败：…」。
   - 空态：一句话说明 + 「添加凭证」主按钮，按钮用主题变量 `--ui-btn-primary-*`。
   - 弹层遮罩、容器背景与输入框背景与 `SettingsPanel` 其它弹层一致，不使用半透明叠色。
4. 文案全部中文，不出现文件路径。

## AC

1. `desktop/tests/credentials-tab.test.tsx`（Vitest + Testing Library，按 `desktop/tests` 现有组件测试写法）：渲染列表；名称非法时保存按钮禁用并显示提示；编辑时值留空提交的请求体不含 `value`；复制引用写入剪贴板的文本为 `${cred:NAME}`。
2. `cd desktop && npx tsc -p tsconfig.json --noEmit` 与 `npm test` 通过。
3. 端到端（主控执行）：`npm run dev` 打开 Near → 设置 → 凭证，新增 `TEST_TOKEN`，刷新后列表仍在、值不显示；复制引用粘贴得到 `${cred:TEST_TOKEN}`；删除后列表消失，`~/.agenticx/credentials.yaml` 中该条不在。

## Out of scope

在 Provider/MCP 编辑表单里内嵌凭证选择器；一键把现有明文迁成引用；系统钥匙串。
