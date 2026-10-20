# 聊天背景效果预设与参数配置

Planned-with: gpt-6.1-sol
Suggested-Impl-Model: gpt-6.1-sol
Plan-Id: chat-background-effects

## 产品契约
仅聊天背景，默认柔和慢速。保留现有动态渐变，新增柔雾噪声、涟漪、玻璃折射、棱纹玻璃、鼠标涟漪。每种可选预设提供专属参数、实时预览及重置。基于配色生成，不处理图片；不改气泡、侧栏、设置主体、后端、消息协议。继续全局/Meta/分身/群聊覆盖、主题导入导出。

## U1 配置与兼容
Suggested-Impl-Model: gpt-6-sol
FR: desktop/electron/chat-appearance-contract.ts 的 Wallpaper、parseAppearance、parseDocument、parseThemePackage、defaultAppearance 升版本2。Wallpaper.effect非shader为null，shader为{id,opacity,params}可判别联合。ID gradient/noise/ripples/glass/fluted-glass/cursor-ripples。opacity 0~1默认0.45，gradient默认1。共享参数元数据维护默认值/范围/步长和验证。
原因：原渲染仅两层渐变，原解析严格拒绝未知字段，单加滑块无法持久化。v1读取转v2：shader→gradient，其他视觉不变；不启动改写，应用才原子持久化。v1/v2包可导入，导出v2；未知字段/版本/参数拒绝。不加IPC。
参数：noise(scale -2~5=2,contrast 0~2=.15,seed整数0~100=0)；ripples(frequency4~40=12,softness0~1=.75,thickness.1~.9=.35)；glass(refraction0~1=.25,scale.2~2=.85,aberration0~.5=.05)；fluted-glass(frequency整数4~40=12,refraction0~2=.35,angle0~360=0)；cursor-ripples(intensity0~10=2,radius.1~1=.3,decay1~20=10)。noise速度=.35*全局速度，ripples=.3*速度，fluted=.12*速度；glass下层渐变缓动，blur固定0；cursor色散固定.1。未开放参数使用固定依赖默认。
AC: chat-appearance.test.ts验证旧配置/三态/严格校验；chat-appearance-store.test.ts验证读取不写、应用v2、覆盖不丢；chat-appearance-package.test.ts验证v1导入与v2往返。

## U2 渲染与生命周期
Suggested-Impl-Model: gpt-6.1-sol
FR: desktop/src/components/appearance/ShaderWallpaper.tsx按effect ID选择组合，shader-runtime.js/.d.ts扩展窄接口。沿用shaders4.0.4与懒加载/disableTelemetry。SimplexNoise/Ripples绘制叠加，Glass/FlutedGlass/CursorRipples包裹渐变、两个局部径向色团和低速噪声细节，使折射有可见素材。shader模式gradient增加移动色团，原gradient壁纸保持原行为。渲染用effectTone派生明暗锚点，不改保存的颜色。
desktop/src/components/appearance/ChatWallpaper.tsx保留焦点/预览优先/隐藏/失焦/reduced-motion/设备故障降级。新效果发送动画就绪后900ms，sin²混合包络回到静态背景；连续效果内置低速驱动。参数只更新属性，不逐帧重建树。鼠标进入最近聊天宿主或预览区域启用，离开卸载；继续pointer-events:none，不取消事件、不逐move setState，不修改库。
desktop/src/appearance/render.ts新增同色静态近似：noise点状纹理，ripples径向波纹，glass柔和镜片高光，fluted棱纹，cursor原渐变。opacity0不运行GPU。
AC: ShaderWallpaper.test.tsx/ChatWallpaper.test.tsx验证效果映射、边界门控、故障/超时/卸载、参数更新、播放结束、鼠标进出与事件正常传播。

## U3 设置与交付
Suggested-Impl-Model: gpt-6-sol
FR: desktop/src/components/settings/appearance/ChatAppearanceSettings.tsx在shader背景下增加效果卡片和仅当前参数；缩略图静态，通过render.ts的effectPreviewBackground以高辨识度形态分别绘制渐变/雾团/波纹/镜片/棱纹/鼠标波纹，主预览唯一GPU。保留配色/气泡/其他变体；换效果重置专属参数。新选择效果默认continuous，用户仍可手动选择on-send/off，已有配置不迁移播放模式。重置效果参数不改变颜色/气泡/播放模式；所有编辑进draft，应用成功生效，失败留草稿。desktop/locales/{zh,en}/settings.json同步中文/英文。参数显示当前值，使用SettingsRangeField。全局motion/speed沿用现有语义。
AC: ChatAppearanceSettings.test.tsx验证切换、参数、重置范围、保存失败/取消/导入回显。desktop/tests/manual/chat-appearance.md补五效果三主题、消息选字/点击/滚动/拖拽、多窗格隔离、重启/包往返及降级用例，由用户手工验收。
验证：相关Vitest、Electron tsc、npm run build、前端tsc对照基线无新错误、git diff --check。仅本次文件。新功能不自动提交/推送。完成提供文件、diff与检查结果。
