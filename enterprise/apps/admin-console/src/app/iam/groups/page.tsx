import { redirect } from "next/navigation";

/** 已并入「组织与成员」的「用户组」tab。旧地址保留兜底。 */
export default function GroupsPage() {
  redirect("/iam/roles?tab=groups");
}
