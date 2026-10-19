# Near 桌面端聊天外观系统三阶段改造计划

Planned-with: gpt-6.1-sol
Suggested-Impl-Model: gpt-6.1-sol
Plan-Id: desktop-chat-appearance

## 产品契约

目标：主题预设 → 参数调整 → 实时示例预览 → 应用保存；Desktop 限定，先静态、再动态、最后身份独立与分享。
默认继承当前配色，不强制切换已有用户；保留 dark/dim/light、原强调色及 Windows 关闭 GPU 的兼容策略。
In scope：聊天列背景、纹理、遮罩、用户/助手气泡配色、三态预设、图片、动态渐变、身份覆盖、主题包。
Out of scope：enterprise、Python 后端、模型/消息/路由协议、主题市场、云同步、远程壁纸、自定义脚本、头像或 Focus Mode 改造。
不覆盖原工作区已有未提交修改；从本地 main 在 codex/desktop-chat-appearance 独立 worktree 实施。

## 证据与设计

- desktop/src/store.ts: ThemeMode/ThemeColor（约95行）、setThemeColor（约1652行）：目前只有五色，保留并新增独立外观存储。
- desktop/src/index.css: :root[data-theme-color]（约820行）：气泡使用 --chat-im-user-* / --chat-im-assistant-*，由窗格局部覆盖，禁止写到 documentElement 造成串色。
- desktop/src/styles/base.css: .agx-chatpane-main-column（约282行）：实底会遮背景。改为聊天列内部 absolute 背景 → 纹理 → 遮罩 → 内容，工具栏/侧卡保持实底。
- desktop/electron/main.ts: saveLayoutData（约603行）吞掉保存异常；新增独立 appearance.json 原子存储，错误返回 UI。
- desktop/electron/main.ts: GPU启动策略（约27行）维持；WebGPU不可用静态降级。
- desktop/src/components/ChatPane.tsx: isGroupPane（约3166行）已有 group: 前缀；外观按稳定身份隔离而非 pane/session ID。

## 配置、接口与持久化

desktop/shared/chat-appearance.ts 定义 v1 配置，variants 包含 light/dim/dark；每个变体包含 wallpaper、pattern、overlay、bubbles。
壁纸类型 default/solid/gradient/image/shader；颜色仅 #RRGGBB（2~4种），角度0~360；图片以assetId引用，裁切中心0~1、缩放1~3、模糊0~24px。
纹理 none/dots/grid/waves，强度0~1；用户气泡纯色/双色渐变，助手纯色；文字自动选择黑或白。
动效 off/on-send/continuous、速度0.25~2。原用户默认 off；新的渐变预设默认 on-send。
预设 default/mist/forest/dusk；基础颜色分别为：
- mist: #60A5FA #A5B4FC #67E8F9 #CBD5E1
- forest: #34D399 #A3E635 #5EEAD4 #94A3B8
- dusk: #A78BFA #F0ABFC #FDA4AF #93C5FD
预设各带三态，通过主题底色混合；编辑只改当前变体。

IPC: loadChatAppearance、saveChatAppearance({expectedRevision,scope,appearance})、importChatWallpaper、readChatWallpaper(assetId)、importChatAppearancePackage、exportChatAppearancePackage。
preload.ts/global.d.ts 同步类型。统一可判别成功/失败；失败给可读错误。主进程串行revision校验，临时文件+rename原子替换。
~/.agenticx/appearance.json 与 appearance-assets/ 分离；损坏配置不自动覆盖。PNG/JPEG/WebP，<=10MiB、<=1600万像素，真实解码校验，哈希ID；禁止SVG/HTML/远程URL/任意路径读取。
不复用视频限定的 agx-media 协议；图片只经受限assetId读取。资源删除/GC不在v1范围。

## U1 静态外观与保存链路
Suggested-Impl-Model: gpt-6-sol

FR-1：SettingsPanel.tsx 显示区在强调色面板后增加 ChatAppearanceSettings（desktop/src/components/settings/appearance/），使用现有设置视觉与SettingsRangeField。预览包括用户/助手、代码/工具卡。中英文文案在desktop/locales/{zh,en}/settings.json。
编辑 draft 仅更新示例；应用成功才更新 saved，取消丢弃；失败保留草稿，按钮近旁显示原错误；离开脏草稿需应用内确认，取消紧靠应用左侧。
FR-2：ChatPane.tsx 的 .agx-chatpane-main-column 内挂载 ChatWallpaper（desktop/src/components/appearance/）；局部变量映射在desktop/src/appearance/。保留UserBubble/ImBubble/GroupTalkReportCard变量用法。im布局支持气泡，clean/terminal仅壁纸。Focus/工作区展开不挂背景。
FR-3：desktop/electron/chat-appearance-store.ts 独立存储与资源管理；desktop/src/appearance/ 使用Zustand。App启动异步加载不阻塞原UI，无配置继承当前主题/强调色；缺失图片仅壁纸降级；失败不伪成功。
AC：chat-appearance.test.ts断言默认继承、校验、三态；chat-appearance-store.test.ts验证原子持久化、失败、revision冲突、损坏文件不覆盖；ChatAppearanceSettings.test.tsx验证预览/取消/保存失败；保留im-bubble-tokens.test.ts默认色断言。图片原文件移除重启后仍可见。

## U2 动态背景与降级
Suggested-Impl-Model: gpt-6.1-sol

FR-4：desktop/package.json固定shaders实际版本及package-lock.json；懒加载ShaderWallpaper.tsx。两层LinearGradient分别取前/后两色（两色重复、三色第三+第一），第二层半透明，角度反向缓变；只更新uniform，不在动画中变编译结构。固定disableTelemetry。
FR-5：ChatPane.sendChat()最终resp.ok成功且reader存在后发本地脉冲，单次调用去重、会话绑定校验；900ms发送动画合并不排队。流token、工具、历史、自动续跑、自动化不触发。窗口隐藏/失焦/reduced-motion停；单个动画画布，设置预览优先、否则聚焦窗格。停止/结束卸载GPU、显示同配色静态图，取消计时器。
FR-6：getWebGPUSupport检测；onReady显动态层、onUnavailable静态降级，5秒未就绪降级；本页面不循环重试，保留用户偏好。Windows GPU启动代码完全不改。设置显示降级原因，不刷toast。
AC：animation-policy.test.ts验证模式/焦点/配额；ShaderWallpaper.test.tsx验证无GPU/超时/运行失败/卸载；send-pulse.test.ts验证发送一次、失败/历史/token不触发及旧会话回调抑制。真机macOS/Windows及打包file://；多窗格流式输入滚动性能与关闭效果对比。
参考：https://shaders.com/docs/guide/hooks-events 、https://shaders.com/docs/guide/telemetry 。

## U3 身份独立与主题包
Suggested-Impl-Model: gpt-6-sol

FR-7：resolveAppearanceScope：null→meta；group:<id>保留；automation:仅全局；其他→avatar:<id>。完整身份快照覆盖 > global > default，不做深合并。编辑器提供全局/Meta/实际分身/群聊目标，跟随全局仅移除覆盖不删资源。同身份跨session继承。
FR-8：.near-theme.json包含format=near-chat-theme、version=1、name、appearance三态、assets{id,mime,base64}；<=20MiB。仅导出有效外观及引用资源，不含绝对路径/身份/消息。导入严格校验、先入草稿，应用才写目标，取消不改设置。未知版本/字段/效果、URL/脚本拒绝。资源保留，不做自动物理删除。
AC：appearance-scope.test.ts验证Meta/分身/群聊/自动化/跨session；chat-appearance-package.test.ts验证往返、路径和身份不泄露、恶意/超限/未知版本拒绝；编辑器导入取消、恢复继承；真机并排不同外观重启恢复。

## 验证与交付

每阶段在desktop运行：npx tsc --noEmit；npx tsc -p electron/tsconfig.json --noEmit；npm run build；相关新增测试+原消息/文案测试。最终npm test，区分既有基线失败与新失败，不弱化断言。
最终覆盖三态/三布局、空态/长历史、流工具、多窗格、Focus、工作区展开、重启、Windows降级及file://。
三个阶段为独立提交边界；只暂存本次文件，计划随代码提交。Plan-Model/Impl-Model均经用户确认为gpt-6.1-sol。
模型推荐：schema/校验/测试gpt-6-luna（边界清晰）；U1/U3 gpt-6-sol（状态与存储）；U2 gpt-6.1-sol（GPU/异步生命周期）。推荐不等同实际记录。
