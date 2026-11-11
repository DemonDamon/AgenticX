# SP6 · 打包与分发收尾

归属：feat/agx-browser-extension · Master Plan 第 4 节 Phase 1 尾
依赖：SP3 + SP4 + SP5 全部完成；**且待拍板决策 #2（分发主路径）已有结论**
闭环定义：manifest 定稿、构建产物可用、按选定分发路径完成首次交付动作

## 0. 防扩散边界

- 不新增功能。本 SP 只做工程化：构建、打包、权限定稿、提交流程
- 不做 Firefox/Safari 适配（P2）
- 不做自动更新服务器

## 1. 任务

### 1.1 构建工程化
- 扩展构建脚本（esbuild 或 vite，选 desktop 生态已有的工具链）：`extension/` 产 dist
- desktop 安装器（electron-builder afterInstall hook）：
  - 自动写入 NM host manifest（替换 SP1 的手动注册，路径改为安装产物内 shim）
  - Windows：注册表 HKCU\Software\Google\Chrome\NativeMessagingHosts（SP1 留的 TODO 在此偿还）

### 1.2 分发路径 A：商店（若决策 #2 = 商店优先）
- 权限定稿复查：无 `<all_urls>` 常驻、`debugger` 保持 optional、权限用途说明逐条写
- Chrome Web Store + Edge Add-ons 提审材料（截图、描述、隐私声明：声明数据全部本地处理）

### 1.3 分发路径 B：企业私发（若决策 #2 = 企业私发优先）
- CRX3 打包 + 自建 update manifest（企业内网可托管）
- 输出 `ExtensionInstallForcelist` 策略配置模板 + 私有化部署文档段落
- 内置 deny 域名清单改为企业可下发配置（读取私有化 gateway 配置）

### 1.4 回归
- SP1-SP5 验收清单全量重跑一遍（打包产物环境，非开发模式）
- 特别是：NM host path 在安装环境下生效（spike 的绝对路径 → 安装相对路径）

## 2. 验收判据

1. 全新机器（无开发模式）：装 desktop → 装扩展 → 六 action + 划词注入全通
2. 按选定路径完成首次交付（商店提交回执 / 企业内网安装手册演练）
3. desktop 全部测试绿

## 3. Sub agent 执行提示

- 先读：SP1 的 NM host 注册实现（要改造成安装器逻辑）、决策 #2 结论
- 若决策 #2 未拍板，本 SP 不开工
