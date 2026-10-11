# SP-M3 — mobile/ Expo 工程骨架 + 扫码配对流程

## 背景与动机

新建 `mobile/`（与 desktop/、enterprise/ 同级，用户指定）。技术选型见
sp-mobile-master.md：Expo managed workflow + TypeScript 严格模式。

## 方案

### 工程骨架

```
mobile/
├── app.json / app.config.ts        # bundle id: com.near.mobile（先占位）
├── eas.json                        # M5 填充，先放 preview 骨架
├── package.json / tsconfig.json    # strict: true
├── app/                            # expo-router 文件路由
│   ├── _layout.tsx
│   ├── index.tsx                   # 入口：未绑定 → 配对页；已绑定 → 会话列表
│   ├── pair.tsx                    # 扫码 + bind
│   └── sessions.tsx                # M4 实装，先放骨架
└── src/
    ├── api/
    │   ├── client.ts               # gateway REST client（fetch 封装 + 错误语义）
    │   └── types.ts                # /api/mobile/* 契约 TS 类型（与 SP-M2 文档一一对应）
    ├── store.ts                    # install_id / mobile_token / gateway base
    │                              #（expo-secure-store，首次生成 install_id）
    └── hooks/usePolling.ts         # 通用轮询 hook（M4 复用）
```

### 配对流程（pair.tsx）

1. `expo-camera` 扫 QR → 解析 `{gateway_base}/connect/{connect_session_id}`
2. `POST {gateway_base}/api/mobile/bind` `{connect_session_id, install_id}`
3. 成功 → secure-store 落 `mobile_token / device_id / gateway_base` → 跳会话页
4. 失败态：无效码 / 已绑定其它设备（提示解绑）/ 网关不可达，均给人话提示

### 纪律

- managed workflow：不 eject、不加需要原生编译的三方库（v1 白名单：
  expo-router / expo-camera / expo-secure-store / expo-constants，其余纯 JS）
- API client 全部强类型，错误分支显式处理（模型护栏）

## 验收标准

- `npx tsc --noEmit` 零错误；`npx expo-doctor` 通过
- `npx expo export --platform web` 或 `expo start` 冒烟可起
- 真机/模拟器手动路径：扫码 → bind → 进会话骨架页（绑定数据持久化，重启不丢）
- 提交 AgenticX main

## 非目标

- 界面美化（M4/M5 迭代）、推送、离线缓存
