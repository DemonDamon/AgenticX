import { redirect } from "next/navigation";

/** 联网搜索已并入「工具与能力」。旧地址保留兜底，书签和外链不断。 */
export default function WebSearchSettingsPage() {
  redirect("/admin/capabilities?tab=search");
}
