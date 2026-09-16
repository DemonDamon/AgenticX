import { describe, expect, it, vi } from "vitest";

import {
  createGroupFromTemplate,
  GroupTemplateCreationCancelledError,
  nextAvailableTemplateGroupName,
  type GroupTemplateCreationApi,
  type GroupTemplateCreationProgress,
} from "./group-template-creation";
import { GROUP_TEMPLATES } from "./group-templates";

function apiMock(overrides: Partial<GroupTemplateCreationApi> = {}): GroupTemplateCreationApi {
  return {
    createAvatar: vi.fn(),
    createGroup: vi.fn(),
    deleteAvatar: vi.fn(async () => ({ ok: true })),
    ...overrides,
  } as GroupTemplateCreationApi;
}

describe("createGroupFromTemplate", () => {
  it("creates fresh tagged avatars before creating the intelligent group", async () => {
    const template = GROUP_TEMPLATES.find((item) => item.id === "team-kb")!;
    let avatarSequence = 0;
    const createAvatar = vi.fn(async () => {
      avatarSequence += 1;
      return { ok: true, avatar: { id: `avatar-${avatarSequence}`, name: "member" } };
    });
    const createGroup = vi.fn(async () => ({
      ok: true,
      group: {
        id: "group-1",
        name: "知识中台",
        avatar_ids: ["avatar-1", "avatar-2", "avatar-3"],
        routing: "intelligent",
      },
    }));
    const api = apiMock({ createAvatar, createGroup });
    const progress: GroupTemplateCreationProgress[] = [];

    const result = await createGroupFromTemplate({
      template,
      groupName: "知识中台",
      api,
      onProgress: (item) => progress.push(item),
    });

    expect(createAvatar).toHaveBeenCalledTimes(template.members.length);
    expect(createAvatar).toHaveBeenNthCalledWith(1, expect.objectContaining({
      name: `知识中台 · ${template.members[0].name}`,
      role: template.members[0].role,
      created_by: "group_template:team-kb",
      tags: expect.arrayContaining(["团队模板", "团队知识库"]),
      system_prompt: expect.stringContaining("你当前服务于「知识中台」团队"),
    }));
    expect(createGroup).toHaveBeenCalledWith({
      name: "知识中台",
      avatar_ids: ["avatar-1", "avatar-2", "avatar-3"],
      routing: "intelligent",
    });
    expect(result.avatarIds).toEqual(["avatar-1", "avatar-2", "avatar-3"]);
    expect(result.group?.id).toBe("group-1");
    expect(progress.at(-1)).toMatchObject({ phase: "complete", percent: 100 });
    expect(api.deleteAvatar).not.toHaveBeenCalled();
  });

  it("rolls back earlier avatars when a later member cannot be created", async () => {
    const template = GROUP_TEMPLATES.find((item) => item.id === "team-kb")!;
    const createAvatar = vi.fn()
      .mockResolvedValueOnce({ ok: true, avatar: { id: "avatar-1", name: "first" } })
      .mockResolvedValueOnce({ ok: false, error: "backend unavailable" });
    const api = apiMock({ createAvatar });

    await expect(createGroupFromTemplate({ template, groupName: "知识中台", api }))
      .rejects.toThrow("backend unavailable 本次已创建的分身已自动清理");

    expect(api.deleteAvatar).toHaveBeenCalledTimes(1);
    expect(api.deleteAvatar).toHaveBeenCalledWith("avatar-1");
    expect(api.createGroup).not.toHaveBeenCalled();
  });

  it("rolls back every new avatar when group creation fails", async () => {
    const template = GROUP_TEMPLATES.find((item) => item.id === "team-kb")!;
    let avatarSequence = 0;
    const createAvatar = vi.fn(async () => {
      avatarSequence += 1;
      return { ok: true, avatar: { id: `avatar-${avatarSequence}`, name: "member" } };
    });
    const api = apiMock({
      createAvatar,
      createGroup: vi.fn(async () => ({ ok: false, error: "group write failed" })),
    });

    await expect(createGroupFromTemplate({ template, groupName: "知识中台", api }))
      .rejects.toThrow("group write failed 本次已创建的分身已自动清理");

    expect(api.deleteAvatar).toHaveBeenCalledTimes(template.members.length);
    expect(api.deleteAvatar).toHaveBeenNthCalledWith(1, "avatar-3");
    expect(api.deleteAvatar).toHaveBeenNthCalledWith(3, "avatar-1");
  });

  it("reports avatars that could not be removed during rollback", async () => {
    const template = GROUP_TEMPLATES.find((item) => item.id === "team-kb")!;
    const createAvatar = vi.fn()
      .mockResolvedValueOnce({ ok: true, avatar: { id: "avatar-1", name: "first" } })
      .mockResolvedValueOnce({ ok: false, error: "second failed" });
    const api = apiMock({
      createAvatar,
      deleteAvatar: vi.fn(async () => ({ ok: false, error: "locked" })),
    });

    await expect(createGroupFromTemplate({ template, groupName: "知识中台", api }))
      .rejects.toThrow("另有 1 个本次新增分身未能自动清理");
  });

  it("honors cancellation between member writes and rolls back safely", async () => {
    const template = GROUP_TEMPLATES.find((item) => item.id === "team-kb")!;
    let cancelled = false;
    const api = apiMock({
      createAvatar: vi.fn(async () => {
        cancelled = true;
        return { ok: true, avatar: { id: "avatar-1", name: "first" } };
      }),
    });

    await expect(createGroupFromTemplate({
      template,
      groupName: "知识中台",
      api,
      shouldCancel: () => cancelled,
    })).rejects.toBeInstanceOf(GroupTemplateCreationCancelledError);

    expect(api.deleteAvatar).toHaveBeenCalledWith("avatar-1");
    expect(api.createGroup).not.toHaveBeenCalled();
  });
});

describe("nextAvailableTemplateGroupName", () => {
  it("keeps the first name and increments later duplicates", () => {
    expect(nextAvailableTemplateGroupName("项目交付", ["其他团队"])).toBe("项目交付");
    expect(nextAvailableTemplateGroupName("项目交付", ["项目交付"])).toBe("项目交付 2");
    expect(nextAvailableTemplateGroupName("项目交付", ["项目交付", "项目交付 2"])).toBe("项目交付 3");
  });
});
