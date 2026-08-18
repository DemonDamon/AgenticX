import { redirect } from "next/navigation";

/** 已并入「工具与能力」。保留跳转，别让存过书签的人撞 404。 */
export default function LegacyCapabilityPacksPage() {
  redirect("/admin/capabilities");
}
