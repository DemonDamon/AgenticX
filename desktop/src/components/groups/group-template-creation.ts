import type { GroupTemplate } from "./group-templates";

export type GroupTemplateCreationPhase =
  | "creating-avatar"
  | "creating-group"
  | "rolling-back"
  | "complete";

export type GroupTemplateCreationProgress = {
  phase: GroupTemplateCreationPhase;
  completed: number;
  total: number;
  percent: number;
  message: string;
};

export type GroupTemplateCreationApi = Pick<
  Window["agenticxDesktop"],
  "createAvatar" | "createGroup" | "deleteAvatar"
>;

type CreateAvatarResponse = Awaited<ReturnType<GroupTemplateCreationApi["createAvatar"]>>;
type CreateGroupResponse = Awaited<ReturnType<GroupTemplateCreationApi["createGroup"]>>;
export type CreatedTemplateAvatar = NonNullable<CreateAvatarResponse["avatar"]>;
export type CreatedTemplateGroup = NonNullable<CreateGroupResponse["group"]>;

export type GroupTemplateCreationResult = {
  groupName: string;
  avatarIds: string[];
  avatars: CreatedTemplateAvatar[];
  group?: CreatedTemplateGroup;
};

type CreateGroupFromTemplateOptions = {
  template: GroupTemplate;
  groupName: string;
  api: GroupTemplateCreationApi;
  onProgress?: (progress: GroupTemplateCreationProgress) => void;
  shouldCancel?: () => boolean;
};

export class GroupTemplateCreationCancelledError extends Error {
  constructor(message = "已取消团队创建。") {
    super(message);
    this.name = "GroupTemplateCreationCancelledError";
  }
}

function emitProgress(
  callback: CreateGroupFromTemplateOptions["onProgress"],
  progress: Omit<GroupTemplateCreationProgress, "percent">,
): void {
  callback?.({
    ...progress,
    percent: progress.total > 0
      ? Math.max(0, Math.min(100, Math.round((progress.completed / progress.total) * 100)))
      : 0,
  });
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const text = String(error ?? "").trim();
  return text || "未知错误";
}

function uniqueTags(templateName: string, memberTags: string[]): string[] {
  return Array.from(new Set(["团队模板", templateName, ...memberTags].map((item) => item.trim()).filter(Boolean)))
    .slice(0, 8);
}

async function rollbackCreatedAvatars(
  api: GroupTemplateCreationApi,
  avatarIds: string[],
  onProgress: CreateGroupFromTemplateOptions["onProgress"],
): Promise<string[]> {
  if (avatarIds.length === 0) return [];
  emitProgress(onProgress, {
    phase: "rolling-back",
    completed: 0,
    total: avatarIds.length,
    message: "创建未完成，正在清理本次新增的分身…",
  });
  const failedIds: string[] = [];
  const reverseIds = [...avatarIds].reverse();
  for (let index = 0; index < reverseIds.length; index += 1) {
    const avatarId = reverseIds[index];
    try {
      const result = await api.deleteAvatar(avatarId);
      if (!result.ok) failedIds.push(avatarId);
    } catch {
      failedIds.push(avatarId);
    }
    emitProgress(onProgress, {
      phase: "rolling-back",
      completed: index + 1,
      total: reverseIds.length,
      message: `正在清理本次新增的分身（${index + 1}/${reverseIds.length}）…`,
    });
  }
  return failedIds;
}

export function nextAvailableTemplateGroupName(
  baseName: string,
  existingNames: string[],
): string {
  const base = baseName.trim() || "新团队";
  const occupied = new Set(existingNames.map((name) => name.trim().toLocaleLowerCase()).filter(Boolean));
  if (!occupied.has(base.toLocaleLowerCase())) return base;
  let suffix = 2;
  while (occupied.has(`${base} ${suffix}`.toLocaleLowerCase())) suffix += 1;
  return `${base} ${suffix}`;
}

export async function createGroupFromTemplate({
  template,
  groupName,
  api,
  onProgress,
  shouldCancel,
}: CreateGroupFromTemplateOptions): Promise<GroupTemplateCreationResult> {
  const normalizedName = groupName.trim();
  if (!normalizedName) throw new Error("请输入团队名称。");
  if (template.members.length === 0) throw new Error("该模板尚未配置成员。");

  const createdAvatarIds: string[] = [];
  const createdAvatars: CreatedTemplateAvatar[] = [];
  const totalSteps = template.members.length + 1;
  const assertNotCancelled = () => {
    if (shouldCancel?.()) throw new GroupTemplateCreationCancelledError();
  };

  try {
    for (let index = 0; index < template.members.length; index += 1) {
      assertNotCancelled();
      const member = template.members[index];
      emitProgress(onProgress, {
        phase: "creating-avatar",
        completed: index,
        total: totalSteps,
        message: `正在创建「${member.name}」（${index + 1}/${template.members.length}）…`,
      });
      const result = await api.createAvatar({
        name: `${normalizedName} · ${member.name}`,
        role: member.role,
        description: member.description,
        tags: uniqueTags(template.name, member.tags),
        system_prompt: `你当前服务于「${normalizedName}」团队。\n\n${member.systemPrompt}`,
        created_by: `group_template:${template.id}`,
      });
      if (!result.ok) {
        throw new Error(result.error || `创建分身「${member.name}」失败。`);
      }
      const avatarId = String(result.avatar?.id ?? "").trim();
      if (!avatarId) {
        throw new Error(`创建分身「${member.name}」后未返回标识，请检查分身列表。`);
      }
      createdAvatarIds.push(avatarId);
      createdAvatars.push(result.avatar!);
      assertNotCancelled();
    }

    assertNotCancelled();
    emitProgress(onProgress, {
      phase: "creating-group",
      completed: template.members.length,
      total: totalSteps,
      message: "成员已就绪，正在创建团队群聊…",
    });
    const groupResult = await api.createGroup({
      name: normalizedName,
      avatar_ids: createdAvatarIds,
      routing: "intelligent",
    });
    if (!groupResult.ok) {
      throw new Error(groupResult.error || "创建团队群聊失败。");
    }

    emitProgress(onProgress, {
      phase: "complete",
      completed: totalSteps,
      total: totalSteps,
      message: "团队创建完成。",
    });
    return {
      groupName: normalizedName,
      avatarIds: [...createdAvatarIds],
      avatars: [...createdAvatars],
      group: groupResult.group,
    };
  } catch (error) {
    const originalMessage = errorText(error);
    if (createdAvatarIds.length === 0) {
      if (error instanceof GroupTemplateCreationCancelledError) throw error;
      throw new Error(originalMessage);
    }
    const failedRollbackIds = await rollbackCreatedAvatars(
      api,
      createdAvatarIds,
      onProgress,
    );
    if (failedRollbackIds.length > 0) {
      throw new Error(
        `${originalMessage} 另有 ${failedRollbackIds.length} 个本次新增分身未能自动清理，请在分身列表中检查。`,
      );
    }
    if (error instanceof GroupTemplateCreationCancelledError) {
      throw new GroupTemplateCreationCancelledError("已取消团队创建，本次新增分身已自动清理。");
    }
    throw new Error(`${originalMessage} 本次已创建的分身已自动清理。`);
  }
}
