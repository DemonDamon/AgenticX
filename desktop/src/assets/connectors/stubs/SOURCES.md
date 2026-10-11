# Connector stub icon sources

Vendor-published or carefully redrawn marks for marketplace cards (local packaging only).

| File | Source | Notes |
|------|--------|-------|
| qingflow.png | Comate-matching redraw | Yellow tile + dark q + gradient tail (Comate catalog ref); official site apple-touch is blue+Q |
| wps.png | App Store (WPS Office, Kingsoft, trackId 599852710) | Official red W app icon, 256×256 (2026-10-08) |
| tencent-docs.png | App Store (腾讯文档, Tencent Technology, trackId 1370780836) | Official blue tile + white T + cyan corner, 256×256 (2026-10-08) |
| outlook.png | App Store (Microsoft Outlook) | Official MS Outlook app artwork |
| amap.png | App Store (高德地图 / AutoNavi) | |
| baidu-maps.png | App Store (百度地图) | |
| tencent-maps.png | App Store (腾讯地图) | |
| tianyancha.png | App Store (天眼查) | |
| qichacha.png | App Store (企查查) | |
| dingtalk.png | App Store (钉钉) | |
| zsxq.png | App Store (知识星球) | |
| yingmi.png | App Store (盈米启明星) | Yingmi Wealth |
| comein.png | App Store (进门) | Finenter / Comein |
| kuaidi100.png | App Store (快递100) | |
| esign.png | App Store (e签宝) | Timevale |
| pkulaw.png | App Store (北大法宝) | Chinalawinfo seal mark |
| neocrm.png | App Store (销售易CRM) | IngageApp / Neocrm |
| lawstar.png | https://www.law-star.com/assets/logo.uSrJdaO6.png (white seal: 法 cut-out + star + ®), recoloured navy rgb(18,53,130) sampled from /assets/print-logo.DawOrOd6.png | Official seal on white, 256×256 (2026-10-08); replaces the old favicon-derived navy tile |
| dichan.png | Comate-matching redraw | House mark (dichan.com favicon used as reference) |
| gildata.png | https://website.gildata.com/assets/logo-DSZmfQOO.png (official 恒生聚源 GILDATA header logo) | G mark (blue arc + orange arrow) cropped from the wordmark, centred on white, 256×256 (2026-10-08); no App Store icon exists |
| gitlab.svg / gitee.svg / linear.svg / asana.svg / zoom.svg / cloudflare.svg | Simple Icons (CC0) | linear.svg fill = brand #5E6AD2 (2026-10-08) |

## Full-bleed retile (2026-10-07)

Marketplace `MarketIcon` no longer wraps logos in a white matte. Stub PNGs that were
glyph-on-white or had large white margins were retiled to solid brand backgrounds:

| File | Change |
|------|--------|
| dichan.png | Redrawn: white house mark on blue gradient tile |
| zsxq.png | Teal brand tile + white glyph (was teal-on-white) |
| gildata.png | Blue brand tile + white G / gold arrow (superseded 2026-10-08 by official logo) |
| outlook.png | Cropped App Store matte; mark scaled on MS blue |
| pkulaw / neocrm / lawstar | Cropped padding or brand-tile fill (lawstar superseded 2026-10-08) |
| linear.svg | White fill for purple mark-tile in MarketIcon (reverted 2026-10-08: white was invisible on the light neutral tile) |

## Theme-adaptive marks (2026-10-08)

`MarketIcon` classifies each mark as `dark` / `light` / `duo` / `color` (`brand-assets.MARK_TONE`
plus the SVG's real fills, including implicit default-black shapes). Only single-tone marks are
filtered: `dark` is inverted in dark/dim themes, `light` is darkened in the light theme. `duo` marks
(both black and white parts) and `color` marks are never filtered. Simple Icons CDN glyphs sit on a
neutral tile, because a brand-tinted tile hides a glyph of the same brand colour.

| File | Source | Notes |
|------|--------|-------|
| ../notion.svg | Official Notion cube mark (same artwork as https://www.notion.com/front-static/logo-ios.png) | Two-tone (`duo`): white cube face + black outline/N. It must never get `brightness(0)`; the old light-theme rule flattened it into a black blob |

## Comate catalog icons (2026-10-08)

Downloaded from Comate `link_templates.icon` CDN (comate-static.wpscdn.cn / open-docs.wpscdn.cn), no secrets:

| File | Template |
|------|----------|
| cnb.png | CNB |
| edgeone.png | EdgeOne Makers |
| gangtise.png | Gangtise投研 |
| ima.png | IMA 知识库 |
| moka.png | Moka 招聘管理 |
| wps-project.png | WPS 项目管理 |
| yuandian.png | 华宇元典法律数据 |
| ifind.png | 同花顺iFinD-A股数据 |
| qixin.png | 启信慧眼 |
| wkinfo.png | 威科先行 |
| xiaoe.png | 小鹅通 |
| mozlen.png | 摩知轮 |
| zhihuiya.png | 智慧芽专利&文献融合检索 |
| fayan.png | 法研·法律法规检索 |
| lexiang.png | 腾讯乐享 |
| wj.png | 腾讯问卷 |
| tdx.png | 通达信MCP |
| jinshuju.png | 金数据 |
| feishu-cli.png | 飞书CLI (listed asset; supply skipped as duplicate of native 飞书) |
