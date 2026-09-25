# HC 用户反馈修复与验证记录

日期：2026-09-14。执行分支：`fix/hc-feedback-20260914`。规划/集成：GPT-6；三个实施子任务：`gpt-5.6-luna / max`。

## 环境与交付范围

- HC 远端 HEAD 和 `hc0905-without-market` 均为 `7a844a87ad27a154c9037b9aefa28355e251aef9`，通过 `git ls-remote hc` 核实；本次修复基于该提交。
- 已从 ontology 切回 HC。停止 ontology 的 Portal、Admin、Gateway、workflow 8091 以及残留 Desktop/Vite/tsc 开发进程。保留其分支、数据库、密钥和运行数据。
- 恢复切换前 HC `.env.local`，连接本地独立 `agenticx_hc0730`；HC JWT/internal token 与数据库配套。旧配置和 Next 构建缓存已备份。
- 本地 HC MySQL 已备份；迁移检查为 43 条、0 条待执行。没有清库或批量改写客户历史。
- 本地服务为 Portal 3000、Admin 3001、Gateway 8088。Edge 中用户提供的 `test.pal.cmccfund.com:3000/3001` 是远端 HC，仅作只读取证。
- 本记录中的真实请求验收均指恢复后的本地 HC；代码按用户后续指示提交并推送，远端测试/生产服务尚未部署本轮修复。

## 反馈、原因与处理

| 反馈 | 代码或页面证据 | 修复 |
| --- | --- | --- |
| Kimi K2.6 触发 Qwen 视觉兜底 | 远端 MOMA 目录将 `Kimi/Kimi-K2.6` 标为 `text`；旧识别函数依赖该标签 | 对已知 K2.5/K2.6 校正视觉识别，显式禁用标记仍优先，泛化 Kimi 不推断视觉能力 |
| 自动附件路由反复误报未配置 | 远端 `cmccfund/qwen3.8` 已启用并具有 local、vision、private-deployment；旧候选读取还受普通用户可见模型过滤 | 从管理员配置独立读取私有附件候选，仍严格检查启用和私有能力；已锁定的文档会话复用私有目标 |
| 图片解析返回 BytesIO 错误 | 原链路将 MIME 标签当作可解码图片，未验证真实编码；原始 5.80 KB 文件未提供，无法确定具体格式 | 浏览器本地将可解码 SVG/AVIF/错标格式转 PNG，普通图片保留原字节前验证实际解码；服务端统一校验格式，坏文件中文报错。SVG 转换拒绝外部资源与可执行内容 |
| 新对话带入错误/附件 | 新会话清理 store，但草稿、附件错误、路由提示等在组件本地 state 中 | 会话切换清空临时输入、附件、提示和预览；异步上传增加会话代次隔离 |
| MD/HTML 引用数字粘连 | 报告产生 `[11](#ref-11)[33](#ref-33)`，渲染为相邻裸数字链接 | 引用分隔并独立显示 `[N]`；MD 使用可点击引用组件；旧 HTML 在预览时修复，不重写存量文件 |
| HTML 列表全是 1 | Markdown 渲染器以空行结束 `<ol>`，每条另起一个列表 | 保留空行间连续列表和嵌套结构；旧 HTML 预览合并相邻普通有序列表，保留显式 start 属性 |
| 未指定格式时 MD 展示不理想 | 默认 delivery format 为 md | 默认 HTML，保留 MD 显式选择及下载产物 |
| 只有一个会话却触发 3 任务限制 | 活动计数释放仅连接响应 EOF/error/cancel，未连接请求 abort | 普通流中断后释放并取消上游 reader；后台深度研究持有计数至实际任务结束，避免提前释放 |
| 历史同步偶发登录失效 | refresh 是单次轮换，多个同时请求可能消费同一个旧 cookie；当前远端能显示历史、本地无待迁移 | 合并重叠刷新及极短时间内的同 cookie 重试，并验证撤销会话不可复活；后台历史追加的 401 不再强制跳转登录，保留输入和待同步消息；未假定 schema 损坏或修改历史数据 |
| arXiv PDF 链接读取失败但搜索可用 | 专用 arXiv 读取只启用 native、未尝试 PDF URL，绕过已有 Jina 回退；关闭搜索时提前走通用提示 | 保留 HTML 优先，再走 PDF 和已有读取回退；显式 URL 直读与搜索 provider 可用性分开，失败提示区分原因 |
| 泛化 Gateway request failed | SDK 忽略顶层业务错误，非 JSON 响应丢失 HTTP 状态 | 保留业务 code/message 与请求 ID；代理 HTML 错误仅显示安全的状态说明 |
| 首次登录可能英文 | 无语言 cookie 时读取浏览器 Accept-Language | Portal/Admin 无偏好固定中文，明确选择英文的 cookie 保留 |
| 有效刷新登录仍跳到登录页 | 原 Portal 为 access 1 小时、refresh 7 天；Server Component 打开工作区调用需要写 Cookie 的刷新函数，抛错后被当成未认证 | 工作区、首页、分享及改密页只读检查后交给专用 Route Handler 写回 Cookie；持久 refresh 会话与后台续期已接通，退出、改密及账号状态仍可撤销 |

| 能力货架消失 | HC `b8b33834` 明确删除入口并将相关 API 改为 404；`826a4711` 另行退役群聊 | 从 HC 父版本 `1cb9343e` 恢复 Admin 货架入口、管理组件、详情及上下架排序接口；专家/市场 Skill 加入新能力包前需上架，存量下架成员仍可编辑移除；保留群聊退役约束 |

## 真实请求与浏览器验证

- 恢复 HC 后登录、会话、模型、历史接口均为 HTTP 200。
- 管理端 `/admin/capabilities` 返回 200 且含“能力货架”；货架接口读取到现有 14 项，配置市场读取到 4 项且无 group，实际条目详情 200；未登录访问货架接口为 401。该验收未修改现有货架配置。
- 普通模型请求经 Portal → Gateway → 上游返回 HTTP 200，得到指定的“测试成功”。
- 同一测试用户连续四次主动关闭聊天流，四次均 HTTP 200；没有在第四次触发 3 任务限制。
- 用户提供的 `https://arxiv.org/pdf/2606.19348` 实际读取到正文；聊天请求返回论文标题 `DeepSeek-V4: Towards Highly Efficient Million-Token Context Intelligence`，流包含 done、无 error，路由原因为 `direct_page_html`，未消费搜索 provider 调用。
- Portal `/auth`、Admin `/login` 均用英语浏览器头测试：无 cookie 时 `html lang=zh-CN`；`NEXT_LOCALE=en` 时 `html lang=en`。四项通过。
- Edge 检查生成报告：相邻 `[11] [33]`、三连引用各自可读；顺序编号 1、2、3 与嵌套列表正确；点击 `[33]` 可定位对应来源。
- Edge 检查“新对话”：输入测试草稿后创建新对话，输入框为空。
- Edge 实际运行图片工具：正常 PNG、MIME 错标转 PNG、SVG 转 PNG、未知坏字节拒绝、仅 PNG 签名的截断文件拒绝，五项通过。没有使用模型生成图片或将测试图片发送到外网。
- 完整重启 HC 后，持久登录的 access TTL 为 3600 秒、refresh Cookie 为 400 天；删除 access Cookie 后打开 `/workspace` 经续期入口返回 200，写回新 Cookie，没有跳到登录页。
- 隔离会话执行两组八个同 refresh token 的并发请求，全部 HTTP 200、共享后继 token；立即旧 token 重试成功。分别携带新 Cookie 和刚轮换的旧 Cookie 登出，两组的新旧 refresh 均为 HTTP 401。另以单元测试覆盖登出发生在轮换尚未完成的竞态。
- 真实 RSA 签名时间推进 8 天：持久 refresh 仍可验证；原 7 天 refresh 与 1 小时 access 均过期，refresh 不可作为 access 使用。
- 验收结束已软删除本轮明确创建的测试对话、退出临时测试登录并关闭报告/图片静态验收服务器；HC 开发服务继续运行。
- 扩展文件上传被 `Allow access to file URLs` 权限限制，未更改浏览器权限；真实原始故障图片的浏览器上传尚未复现。无效输入与会话隔离由专项测试验证。

## 验证边界

- 远端历史请求 ID 在当前管理台查询未找到对应错误明细，无法追溯断言图一真实上游失败的唯一原因。本次修复保证错误不被 SDK 吞成通用消息，需部署后利用具体状态/请求 ID 继续定位供应商异常。
- 本地模型目录没有客户的 Kimi K2.6 供应商配置；Kimi 识别与转发、隐藏私有目标及历史文档后续轮次通过确定性路由测试验证，未声称已连接客户 Kimi 上游完成验收。
- 原始故障图片仅有截图，没有图片文件本体，不能断言它就是 SVG、AVIF 或损坏文件。
- 能力货架恢复入口是 Admin `/admin/capabilities` 的“能力货架”；Portal 员工自助市场按 HC 现行策略保持关闭。IAM 用户组 assignment 继续有效，它与退役的 project-group capability 是不同概念。
- 当前并发准入与刷新合并保持原有单进程部署边界；未引入分布式锁或更改企业私有数据边界。
- 持久登录不延长访问 JWT：access 与 Gateway grant 保持 1 小时；服务端刷新会话使用持久截止标记并依靠撤销/账号状态校验。Cookie 使用 400 天保留窗口并随轮换续写，符合 [Chrome 的 Cookie 保留上限](https://developer.chrome.com/blog/cookie-max-age-expires)。清除浏览器 Cookie 或浏览器自身回收数据后仍需登录。
- 仍有效的旧 7 天 refresh 会在下一次轮换升级为持久会话；已经过期或被撤销的凭据需要重新登录一次，不能通过延长新策略恢复。
- 改密撤销接口已在本地 MySQL 用四条合成数据验证：该用户两个设备均失效，其他用户和同 ID 的其他租户均保留；测试数据已清理。
- 历史恢复按用户要求降低优先级；现有历史可加载，未发现需要数据恢复的确证，因此未写入历史数据。

## 自动化检查

阶段检查：合并后的 Portal chat/附件、并发、刷新、研究生命周期与 URL dispatcher，七个文件、201 项测试通过。图片工具与附件分类 12 项通过。持续登录 auth-runtime/coordination/session 16 项通过；JWT 持久凭据、按用户撤销、共享密码变更测试 7 项通过；聊天租约、研究生命周期与 URL reader 164 项通过；SDK HTTP 26 项通过。报告/前端/语言专项通过；历史 Store 14 个文件 57 项通过，RSC/keepalive 5 个文件 8 项通过，迟到的 refresh 响应不会在退出后重启 outbox。

最终整合 TypeScript 检查：Portal、Admin、feature-chat、auth、iam-core 五组均通过；config、core-api、SDK 也已在本轮检查通过。货架专项 115 项通过；根任务整合货架 UI/接口/契约 10 个文件 88 项通过；最终认证、会话、keepalive 与 refresh 入口 5 个文件 24 项通过。慢数据库删除超过 65 秒期间，新轮换持续被拒绝；成功/失败的退出握手均清理状态。`git diff --check` 通过。

详细本地输出保存在 `/private/tmp/hc-feedback-20260914/`；此目录含私有环境验收材料，不作为公开静态站点或提交内容。


## 追加：Near 定时运行历史

用户确认定时任务历史问题出现在 Near 桌面端。只读接口取证：全局会话列表已有 3 条定时运行，两个任务的已保存消息也都存在；因此不做数据迁移。缺陷是 Desktop 全局历史归一化与全局搜索主动过滤 `automation:*`。

- 保留未归档的定时运行，并显示“定时任务”来源；Meta/分身专属历史仍按身份隔离。
- 点开历史和搜索结果时，按运行 session 与 automation 身份精确匹配窗格；任务最新运行绑定不受回看操作影响。
- 自动运行获得持久 session 后立即刷新历史目录；保留原有轮询作为后续同步。
- 在最新主线独立工作区实施，再按精确修改同步至当前交付工作区；保留交付分支的项目/任务分类、模型路由锁和品牌差异。
- 实际 Electron 热更新后，项目历史显示全部 3 条已保存定时运行；全局搜索命中两条不同日期的验收运行。点击 18 天前的历史与搜索结果，均显示各自日期和消息。回看前后任务配置 SHA256 一致，未触发新运行。
- 主线 Desktop 定向 19 项通过；交付 Desktop 定向 18 项通过，完整 TypeScript 检查通过。尚未重新打包或发布桌面应用。
- 补修 `/api/projects` 的冷恢复目录读取：优先持久化的 `ManagedSession.taskspaces`，兼容 live StudioSession fallback。主线和交付分支各 3 项后端回归通过。未重启当前调度进程，该后端变更随下一次正常启动/构建生效；当前历史可见性修复已经通过热更新生效。
- 推送前补充启动检查：隔离的真实 `create_studio_app()` 与 TestClient lifespan 正常启动/关闭，`/api/session`、`/api/avatars`、`/api/sessions` 均返回 200；会话生命周期与 avatar 创建读取两项现有回归通过。未重启实际桌面应用或触发真实定时任务。


## 追加：MiniMax 与通用图片输入能力

远端管理台只读确认配置中同时存在 `Minimax/Minimax-M3` 与 `Minimax/Minimax-M2.7`，两者持久化能力均显示 `text`。这证明当前接入目录存在不完整声明，不能据此断言供应商 `/models` 原始响应本身错标。

[MiniMax OpenAI 兼容协议](https://platform.minimax.io/docs/api-reference/text-openai-api) 明确 M3 支持 image_url 输入；[Anthropic 兼容协议](https://platform.minimax.io/docs/api-reference/text-anthropic-api) 明确 M2.7/M2.x 仅文本和工具内容，不支持图片输入。聚合服务是否完整透传该协议尚未进行真实图片调用，不能把型号能力等同于当前供应商通道已验收。

代码证据：手动新增未传 capabilities，POST 默认写 `["text"]`；上游模型拉取仅保留 ID 和窗口，丢弃输入模态；管理页没有通用能力编辑入口。修复覆盖共享能力判断、上游元数据保留和每模型显式覆盖，不仅增加型号别名。

根任务扩展 Portal 路由矩阵：原生 M3、未知别名显式支持、未知别名上游 vision 直接传图；GLM 文本模型、M2.7、M3 管理员显式禁用或上游明确 no-vision 时先走私有预解析；整个 chat route 文件 34 项通过。既有图片格式校验和附件会话隔离继续保留。

完成的通用接入链路：

- OpenAI 兼容模型目录保留输入模态元数据；输出图片能力不当作图片输入，供应商返回的管理员 override/private-deployment 标记不被采信。手动新增缺失能力时使用共享推断。
- Admin 模型行增加“图片输入：自动 / 支持 / 不支持”，复用已有单模型 PATCH。保存成功才回显，切回自动仅移除 override，保留上游原始能力；重新启用和价格编辑不覆盖能力。已有配置与拉取目录合并时保留管理员覆盖。嵌入模型不展示此开关。
- Portal、Admin 路由候选与 HC Desktop 对非空能力元数据使用相同判断。Desktop 当前窗格模型的上传、粘贴、拖拽图片入口统一消费 modelCatalog；无元数据时保留旧版兼容行为，视频入口维持原逻辑。
- 本地 Edge 实际展开三态菜单并检查图片 badge 与模型列表布局；没有修改客户模型配置。实际 Near 热更新正常，共享代码导入未导致 Vite 页面错误。

追加验证：共享能力及 Admin API/解析定向 6 个文件 36 项通过；Admin 目录合并与三态 helper 6 项通过；Desktop 图片能力 9 项通过；Portal chat route 34 项通过。Admin、Portal、config 与 HC Desktop 完整 TypeScript 检查均通过。上述路由测试使用受控上游响应，不代表已连接客户 MiniMax/Kimi 通道传图成功。远端 HC 尚未部署。

单模型 PATCH 补充 3 项通过：支持/禁用/自动声明可保存，只改启停或上下文窗口不清除原能力，无 provider:update 权限拒绝修改。价格走独立 metering/pricing 接口，不写 provider model capabilities。
