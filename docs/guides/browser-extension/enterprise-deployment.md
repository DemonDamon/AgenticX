# AGX Bridge · 企业私发部署指南（Forcelist + 私有化）

> SP6 产出。双路径分发中的「企业私发路径」；商店路径见
> [store-listing-zh.md](./store-listing-zh.md)。适用于内网/受管环境批量安装
> AGX 浏览器扩展，不依赖 Chrome Web Store。

## 0. 产物与前置

| 产物 | 生成方式 | 用途 |
| --- | --- | --- |
| `agx-bridge-<version>.crx` | `node scripts/build-extension.mjs --key <pem>` | 自签 CRX3，供内网文件服务器分发 |
| `updates.xml` | 同上（模板） | 扩展自动更新的 update manifest |
| AGX 桌面端安装包 | `desktop/` electron-builder 产物 | NM host 注册随桌面端首次启动自动完成 |

CRX3 由仓库脚本自签（CrxFileHeader protobuf + RSASSA-PKCS1-v1_5-SHA256 over
`"CRX3 SignedData\0" + LE32 + signed_header_data + archive`），结构与签名算法已与
`Chrome --pack-extension` 参考产物交叉验证；签名 key 默认用
`extension/test-extension-key.pem`（与 manifest `key` 匹配，安装后扩展 ID 固定为
`kajgkmohjdflaidencpfmebbjibfieka`）。**生产环境请替换为企业自己的私钥并同步
manifest `key`**（`openssl genrsa -out enterprise.pem 2048` + 重新生成 base64 key）。

## 1. 托管产物（内网文件服务器）

把 CRX 与 update manifest 放到内网 HTTPS 服务器（例如 `https://agx-internal.example.com/ext/`）：

```text
https://agx-internal.example.com/ext/agx-bridge-0.1.0.crx
https://agx-internal.example.com/ext/updates.xml
```

编辑 `updates.xml`，把 `codebase` 指向真实 CRX URL（模板默认占位
`https://INTERNAL-HOST.example.com/...`）：

```xml
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='kajgkmohjdflaidencpfmebbjibfieka'>
    <updatecheck codebase='https://agx-internal.example.com/ext/agx-bridge-0.1.0.crx' version='0.1.0' />
  </app>
</gupdate>
```

> 要求：HTTPS、服务器支持 Range 请求、不跟随重定向到外网。发新版时更新 CRX 文件
> 与 `updates.xml` 的 `codebase`/`version`，Chrome 会在策略刷新时自动升级。

## 2. 下发 ExtensionInstallForcelist 策略

Forcelist 条目格式：`<扩展ID>;<update manifest URL>`。

### macOS（MDM / config profile）

```xml
<key>ExtensionInstallForcelist</key>
<array>
  <string>kajgkmohjdflaidencpfmebbjibfieka;https://agx-internal.example.com/ext/updates.xml</string>
</array>
```

放到 `com.google.Chrome` 域（payload type `com.apple.ManagedClient.preferences`，
preference domain `com.google.Chrome`）。

命令行快速验证（单机，需重启 Chrome 生效）：

```bash
defaults write com.google.Chrome ExtensionInstallForcelist -array \
  "kajgkmohjdflaidencpfmebbjibfieka;https://agx-internal.example.com/ext/updates.xml"
```

### Windows（GPO / 注册表）

策略路径
`HKLM\Software\Policies\Google\Chrome\ExtensionInstallForcelist`：

```powershell
reg add "HKLM\Software\Policies\Google\Chrome\ExtensionInstallForcelist" `
  /v 1 /t REG_SZ /d "kajgkmohjdflaidencpfmebbjibfieka;https://agx-internal.example.com/ext/updates.xml" /f
```

（GPO 模板：`Computer Configuration → Administrative Templates → Google →
Google Chrome → Extensions → Configure the list of force-installed extensions`。）

### Edge

把上述路径中的 `Google\Chrome` 换成 `Microsoft\Edge`、managed domain 换成
`com.microsoft.Edge` 即可（Edge Add-ons 商店路径同样适用，材料见 store-listing）。

## 3. NM host 注册（随桌面端自动完成）

Forcelist 装上扩展后，扩展需要 NM host 才能与桌面端通信：

- **安装 AGX 桌面端**即可：桌面端启动时幂等执行 `installNmHost({ mode: "installed" })`
  （desktop/electron/main.ts 挂载）——
  - macOS：写 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.agenticx.bridge.json`
    （`allowed_origins` 含扩展 ID；host 为 `~/.agenticx/agx-nm-bridge-host.sh`，
    以 `ELECTRON_RUN_AS_NODE=1` 复用桌面端二进制运行打包内 shim，终端用户机器**无需安装 Node**）；
  - Windows：写 `%USERPROFILE%\.agenticx\nm-hosts\com.agenticx.bridge.json` 并注册
    `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.agenticx.bridge`（用户级，
    无需管理员权限）。**注：Windows 注册表执行逻辑已单测覆盖命令构造，尚未在真
    Windows 机器上运行验证，首发前请在 Windows 试点的机器上冒烟。**
- 桌面端 dev（`npm run dev`）与 `scripts/install-extension-dev.sh` 产出的是 dev 模式
  注册（系统 node + 仓库 shim），二者写同一组文件、内容一致，不会互相覆盖出错。

## 4. 企业敏感域拦截下发（可选）

在内置银行/证券等拦截清单之外，企业可追加自己的 deny 域名。在**AGX 桌面端配置**
（`~/.agenticx/config.yaml`，即 AGX_HOME 下的 gateway 配置）里加：

```yaml
enterprise:
  enabled: true
  token: <企业审计 token>
  browser_deny_domains:      # SP6 新增：追加到浏览器侧 deny 清单
    - internal-crm.corp.example.com
    - mail.corp.example.com
```

- 桌面端通过 NM 心跳（pong 帧）把该清单推给扩展；扩展选项页会显示「企业已下发
  N 个额外拦截域名」；
- **企业下发的拦截不可被用户在扩展选项页放行**（优先级高于用户 allow 清单）；
- 修改配置后无需重启桌面端，下一次心跳（≤1 分钟）自动生效；
- 扩展与桌面端未连接时按最近一次同步的清单执行。

## 5. 冒烟清单（企业试点）

1. `node scripts/build-extension.mjs --key <enterprise.pem>` 产出 CRX + updates.xml；
2. 内网服务器上架两个文件，浏览器直接下载 CRX 应被 Chrome 拒绝直接打开（正常，
   只允许策略安装）；
3. 下发 Forcelist 策略 → 重启浏览器 → chrome://extensions 显示「由管理员安装」
   且 ID 为 `kajgkmohjdflaidencpfmebbjibfieka`；
4. 安装 AGX 桌面端并启动 → 扩展弹窗「连接 AGX 桌面端」应显示已连接（RTT < 50ms）；
5. 在 `config.yaml` 配一个测试 deny 域 → 1 分钟内对该域执行 open/extract 应被拦截，
   选项页出现「企业已下发 1 个额外拦截域名」；
6. 卸载验证：移除策略 + 卸载桌面端 → `scripts/uninstall-extension-dev.sh`（macOS）
   清理 NM host 注册文件。
