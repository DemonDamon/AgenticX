---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/skills-api
fetched: 2026-10-23
title: Skill
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Skill

> 技能以 zip 包封装工具组合与文档。上传后经安全扫描方可挂载到智能体，挂载时锁定具体版本号。

<meta property="og:title" content="Skill" />

## 扫描状态 <span id="h-skills-scan" />

新建技能或上传新版本后进入安全扫描，`status` 状态流转如下：

<table style={{ display: "table", tableLayout: "fixed", width: "100%" }}><colgroup><col style={{ width: "22%" }} /><col style={{ width: "78%" }} /></colgroup><thead><tr><th><p><strong>状态</strong></p></th><th><p><strong>含义</strong></p></th></tr></thead><tbody><tr><td><p><code>checking</code></p></td><td><p>扫描中，暂不可挂载</p></td></tr><tr><td><p><code>active</code></p></td><td><p>扫描通过，可挂载到智能体</p></td></tr><tr><td><p><code>rejected</code></p></td><td><p>命中安全风险，不可挂载；版本详情中 <code>additional\_properties.error\_info</code> 给出按文件路径列出的问题</p></td></tr><tr><td><p><code>deleted</code></p></td><td><p>技能已删除</p></td></tr></tbody></table>

挂载在智能体上完成，详见 Agent 的 `skills` 字段。挂载时必须指定具体的 `version`（不支持 `latest`），后续上传新版本不影响已挂载的智能体。

## 技能操作 <span id="h-skills-ops" />

<table style={{ display: "table", tableLayout: "fixed", width: "100%" }}><colgroup><col style={{ width: "28%" }} /><col style={{ width: "32%" }} /><col style={{ width: "40%" }} /></colgroup><thead><tr><th><p><strong>操作</strong></p></th><th><p><strong>端点</strong></p></th><th><p><strong>说明</strong></p></th></tr></thead><tbody><tr><td><p><a href="/zh/model-studio/skill-create">创建 Skill</a></p></td><td><p><code>POST /skills</code></p></td><td><p>用已上传的 zip 包 <code>file\_id</code> 创建技能</p></td></tr><tr><td><p><a href="/zh/model-studio/skill-get">查询 Skill</a></p></td><td><p><code>GET /skills/\{skill\_id}</code></p></td><td><p>获取技能元数据与最新版本号</p></td></tr><tr><td><p><a href="/zh/model-studio/skill-list">列出 Skill</a></p></td><td><p><code>GET /skills</code></p></td><td><p>分页列出技能，支持按 <code>source</code> 过滤自建/官方</p></td></tr><tr><td><p><a href="/zh/model-studio/skill-delete">删除 Skill</a></p></td><td><p><code>DELETE /skills/\{skill\_id}</code></p></td><td><p>删除技能及全部版本；已挂载旧版本的智能体不受影响</p></td></tr></tbody></table>

## 版本操作 <span id="h-skills-ver-ops" />

<table style={{ display: "table", tableLayout: "fixed", width: "100%" }}><colgroup><col style={{ width: "28%" }} /><col style={{ width: "32%" }} /><col style={{ width: "40%" }} /></colgroup><thead><tr><th><p><strong>操作</strong></p></th><th><p><strong>端点</strong></p></th><th><p><strong>说明</strong></p></th></tr></thead><tbody><tr><td><p><a href="/zh/model-studio/skill-version-create">上传 Skill 新版本</a></p></td><td><p><code>POST /skills/\{skill\_id}/versions</code></p></td><td><p>用新的 zip 包 <code>file\_id</code> 上传新版本；已挂载旧版本不受影响</p></td></tr><tr><td><p><a href="/zh/model-studio/skill-version-list">列出 Skill 版本</a></p></td><td><p><code>GET /skills/\{skill\_id}/versions</code></p></td><td><p>分页列出该技能的全部版本，按版本号倒序</p></td></tr><tr><td><p><a href="/zh/model-studio/skill-version-get">查询 Skill 版本</a></p></td><td><p><code>GET /skills/\{skill\_id}/versions/\{version}</code></p></td><td><p>查询指定版本的元数据与扫描状态</p></td></tr><tr><td><p><a href="/zh/model-studio/skill-version-download">下载 Skill 包</a></p></td><td><p><code>GET /skills/\{skill\_id}/versions/\{version}/content</code></p></td><td><p>返回 OSS 预签名 URL（2 小时有效），用于下载 zip 包</p></td></tr></tbody></table>
