"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@agenticx/ui";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";

import { adminFetch } from "../lib/admin-client-auth";
import {
  childrenByParent,
  deleteBlockedReason,
  departmentSubtreeIds,
  movableParentOptions,
  type DepartmentNode,
} from "../lib/department-tree";

export type OrganizationNode = DepartmentNode;

/** 全部 / 未归属 这两档不是部门，用哨兵值表示，避免和真实部门 id 混。 */
export const ALL_DEPARTMENTS = "__all__";
export const NO_DEPARTMENT = "__none__";
/** 移动对话框里「挂到顶级」那一项。Select 不接受空字符串做值。 */
const ROOT_PARENT = "__root__";

export type DepartmentFilter = typeof ALL_DEPARTMENTS | typeof NO_DEPARTMENT | string;

export { departmentSubtreeIds };

type PendingDialog =
  | { kind: "create"; parent: OrganizationNode | null }
  | { kind: "rename"; node: OrganizationNode }
  | { kind: "move"; node: OrganizationNode }
  | { kind: "delete"; node: OrganizationNode };

function Branch({
  node,
  children,
  selected,
  onSelect,
  onConfigureModels,
  onAction,
  depth,
}: {
  node: OrganizationNode;
  children: Map<string | null, OrganizationNode[]>;
  selected: DepartmentFilter;
  onSelect: (value: DepartmentFilter) => void;
  onConfigureModels: (node: OrganizationNode) => void;
  onAction: (dialog: PendingDialog) => void;
  depth: number;
}) {
  const childNodes = children.get(node.id) ?? [];
  const [open, setOpen] = useState(depth < 1);
  const isSelected = selected === node.id;

  return (
    <div>
      <div
        className={`group flex items-center gap-1 rounded-md pr-1 text-sm ${
          isSelected ? "bg-muted font-medium" : "hover:bg-muted/60"
        }`}
        style={{ paddingLeft: `${4 + depth * 14}px` }}
      >
        {childNodes.length > 0 ? (
          <button
            type="button"
            aria-label={open ? "收起" : "展开"}
            className="shrink-0 rounded p-0.5 hover:bg-muted"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          type="button"
          className="min-w-0 flex-1 truncate py-1.5 text-left"
          onClick={() => onSelect(node.id)}
          title={node.path}
        >
          {node.name}
        </button>
        <span className="shrink-0 text-xs text-muted-foreground">{node.memberCount}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          title="配置该部门的模型上限与额度"
          onClick={() => onConfigureModels(node)}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              title={`管理「${node.name}」`}
              aria-label={`管理「${node.name}」`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onAction({ kind: "create", parent: node })}>
              <FolderPlus className="h-3.5 w-3.5" />
              新建子部门
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction({ kind: "rename", node })}>
              <Pencil className="h-3.5 w-3.5" />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction({ kind: "move", node })}>
              <ChevronRight className="h-3.5 w-3.5" />
              移动到…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => onAction({ kind: "delete", node })}
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {open
        ? childNodes.map((child) => (
            <Branch
              key={child.id}
              node={child}
              children={children}
              selected={selected}
              onSelect={onSelect}
              onConfigureModels={onConfigureModels}
              onAction={onAction}
              depth={depth + 1}
            />
          ))
        : null}
    </div>
  );
}

/**
 * 成员列表左栏的组织树：既是筛选器，也是唯一的部门管理入口。
 *
 * 部门管理原本是一个独立菜单。菜单收掉之后这里只剩筛选，等于建子部门、改名、调结构
 * 全都没了地方——树看得见改不动。所以增删改挂回每个节点上：点部门筛人是高频操作，
 * 顺手就能改这个部门的名字、位置、模型上限。
 *
 * 写操作直接打接口而不是层层往上抛：调用方（成员页）只需要在结构变了之后重新拉一次
 * 数据，不必知道部门是怎么建的。
 */
export function DepartmentFilterTree({
  nodes,
  selected,
  onSelect,
  onConfigureModels,
  onChanged,
  totalCount,
  unassignedCount,
}: {
  nodes: readonly OrganizationNode[];
  selected: DepartmentFilter;
  onSelect: (value: DepartmentFilter) => void;
  onConfigureModels: (node: OrganizationNode) => void;
  /** 结构改完之后重新拉数据。 */
  onChanged: () => void;
  totalCount: number;
  unassignedCount: number;
}) {
  const children = useMemo(() => childrenByParent(nodes), [nodes]);
  const roots = children.get(null) ?? [];
  const [dialog, setDialog] = useState<PendingDialog | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftParent, setDraftParent] = useState<string>(ROOT_PARENT);
  const [busy, setBusy] = useState(false);

  const openDialog = useCallback((next: PendingDialog) => {
    setDialog(next);
    setDraftName(next.kind === "rename" ? next.node.name : "");
    setDraftParent(next.kind === "move" ? next.node.parentId ?? ROOT_PARENT : ROOT_PARENT);
  }, []);

  const send = useCallback(
    async (path: string, method: string, body?: unknown) => {
      setBusy(true);
      try {
        const res = await adminFetch(path, {
          method,
          headers: { "Content-Type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const json = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
        if (!res.ok || (json.code && json.code !== "00000")) {
          // 后端把「还有子部门/还有人」回成错误码，直接抛给用户看是天书。
          throw new Error(deleteBlockedReason(json.message ?? "") ?? json.message ?? "操作失败");
        }
        setDialog(null);
        onChanged();
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "操作失败");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );

  const confirm = useCallback(async () => {
    if (!dialog) return;
    const name = draftName.trim();
    if (dialog.kind === "create") {
      if (!name) return;
      const ok = await send("/api/admin/departments", "POST", {
        name,
        parentId: dialog.parent?.id ?? null,
      });
      if (ok) toast.success(`已建部门「${name}」`);
      return;
    }
    if (dialog.kind === "rename") {
      if (!name || name === dialog.node.name) return;
      const ok = await send(
        `/api/admin/departments/${encodeURIComponent(dialog.node.id)}`,
        "PATCH",
        { name },
      );
      if (ok) toast.success("已改名");
      return;
    }
    if (dialog.kind === "move") {
      const parentId = draftParent === ROOT_PARENT ? null : draftParent;
      if (parentId === (dialog.node.parentId ?? null)) return;
      const ok = await send(
        `/api/admin/departments/${encodeURIComponent(dialog.node.id)}`,
        "PATCH",
        { parentId },
      );
      if (ok) toast.success("已移动");
      return;
    }
    const ok = await send(
      `/api/admin/departments/${encodeURIComponent(dialog.node.id)}`,
      "DELETE",
    );
    if (ok) toast.success(`已删除「${dialog.node.name}」`);
  }, [dialog, draftName, draftParent, send]);

  // 只有一个顶级部门、又没有未归属的人时，「全部成员」和那个部门点下去结果一模一样。
  // 两行显示同一个数字、筛出同一批人，是纯噪音——这种时候只留部门那一行（它还带着
  // 模型上限和额度的入口），把「全部成员」隐掉。
  const allMembersIsRedundant = roots.length === 1 && unassignedCount === 0;

  return (
    <div className="space-y-0.5">
      <div className="mb-1 flex items-center justify-between gap-1 px-2">
        <span className="text-xs font-medium text-muted-foreground">组织</span>
        <Button
          variant="ghost"
          size="icon-sm"
          title="新建顶级部门"
          aria-label="新建顶级部门"
          onClick={() => openDialog({ kind: "create", parent: null })}
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {allMembersIsRedundant ? null : (
        <button
          type="button"
          className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm ${
            selected === ALL_DEPARTMENTS ? "bg-muted font-medium" : "hover:bg-muted/60"
          }`}
          onClick={() => onSelect(ALL_DEPARTMENTS)}
        >
          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">全部成员</span>
          <span className="text-xs text-muted-foreground">{totalCount}</span>
        </button>
      )}
      {roots.length === 0 ? (
        <p className="px-2 py-3 text-xs text-muted-foreground">
          还没有部门。建一个之后，模型上限和额度就能按部门发。
        </p>
      ) : null}
      {roots.map((node) => (
        <Branch
          key={node.id}
          node={node}
          children={children}
          selected={allMembersIsRedundant && selected === ALL_DEPARTMENTS ? node.id : selected}
          onSelect={onSelect}
          onConfigureModels={onConfigureModels}
          onAction={openDialog}
          depth={0}
        />
      ))}
      {unassignedCount > 0 ? (
        <button
          type="button"
          className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm ${
            selected === NO_DEPARTMENT ? "bg-muted font-medium" : "hover:bg-muted/60"
          }`}
          onClick={() => onSelect(NO_DEPARTMENT)}
        >
          <span className="w-3.5" />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">未归属组织</span>
          <span className="text-xs text-muted-foreground">{unassignedCount}</span>
        </button>
      ) : null}

      <Dialog open={dialog !== null} onOpenChange={(open) => (open ? null : setDialog(null))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialog?.kind === "create"
                ? dialog.parent
                  ? `在「${dialog.parent.name}」下新建子部门`
                  : "新建顶级部门"
                : dialog?.kind === "rename"
                  ? "重命名部门"
                  : dialog?.kind === "move"
                    ? `移动「${dialog.node.name}」`
                    : `删除「${dialog?.node.name}」`}
            </DialogTitle>
            {dialog?.kind === "delete" ? (
              <DialogDescription>
                部门下还有子部门或成员时删不掉，会告诉你先处理哪一个。已经发给这个部门的
                模型上限和额度会一并失效。
              </DialogDescription>
            ) : dialog?.kind === "move" ? (
              <DialogDescription>
                部门是模型上限的天花板，换了上级就跟着换一套。自己的子部门不在可选项里。
              </DialogDescription>
            ) : null}
          </DialogHeader>

          {dialog?.kind === "create" || dialog?.kind === "rename" ? (
            <div className="space-y-1.5">
              <Label className="text-xs">部门名称</Label>
              <Input
                value={draftName}
                autoFocus
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void confirm();
                }}
                placeholder="如：研发中心"
              />
            </div>
          ) : null}

          {dialog?.kind === "move" ? (
            <div className="space-y-1.5">
              <Label className="text-xs">移动到</Label>
              <Select value={draftParent} onValueChange={setDraftParent}>
                <SelectTrigger>
                  <SelectValue placeholder="选择上级部门" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROOT_PARENT}>（顶级，不挂在任何部门下）</SelectItem>
                  {movableParentOptions(nodes, dialog.node.id).map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.path || option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialog(null)} disabled={busy}>
              取消
            </Button>
            <Button
              size="sm"
              variant={dialog?.kind === "delete" ? "destructive" : "default"}
              disabled={
                busy ||
                ((dialog?.kind === "create" || dialog?.kind === "rename") && draftName.trim() === "")
              }
              onClick={() => void confirm()}
            >
              {dialog?.kind === "delete" ? "删除" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
