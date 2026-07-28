# Portal Composer：加号菜单 + 文件附件解析问答

Planned-with: composer-2.5  
Suggested-Impl-Model: composer-2.5

## 问题

输入区 Paperclip / 联网搜索并列，默认联网关闭；附件仅图片。要对齐加号聚合入口，联网默认「自动」，并支持文档上传解析后实时问答（忽略插件/技能）。

## In scope

1. Composer 「+」菜单：文件和图片、联网搜索（自动/关闭）；默认自动
2. 附件：PDF / Word(docx) / Excel / PPT(pptx) / 图片；上限 50 个、单文件 100MB（图片 data URL 仍限 5MB）
3. BFF `POST /api/chat/attachments/parse` 抽正文；问答时注入 user content，图片继续 multimodal
4. sanitize / store / AttachmentChip 支持 document
5. `extractLastUserQuery` 兼容 multimodal content
6. 视频：可上传并展示文件名，暂不解析二进制（UI 提示）

## Out of scope

- 插件 / 技能菜单项
- Desktop Machi
- 真模型判定「是否需要联网」（自动 = 发送时开启联网检索）
- 旧版 .doc/.xls/.ppt 二进制（需 LibreOffice）

## 落点

| 层 | 路径 |
|----|------|
| UI | `MachiChatView.tsx`、新建 `ComposerPlusMenu.tsx` |
| Hook | `useComposerAttachments.ts`、`composer-attachment.ts`、`AttachmentChip.tsx` |
| DTO | `core-api` / `sdk-ts` ChatMessageAttachment |
| Sanitize | `chat-message-sanitize.ts` |
| Store | `store.ts` 文档文本注入 + 附件过滤 |
| Parse | `lib/attachment-parse.ts` + `api/chat/attachments/parse/route.ts` |
| i18n | zh/en |

## AC

- AC-1: 「+」打开菜单，无插件/技能项
- AC-2: 联网默认「自动」，可选关闭
- AC-3: 上传 PDF/docx 后可基于内容问答
- AC-4: 图片仍走 vision multimodal
- AC-5: 超限给出可读错误
