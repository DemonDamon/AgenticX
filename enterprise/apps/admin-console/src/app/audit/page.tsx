import { redirect } from "next/navigation";

/** 已并入「安全与审计」。旧地址保留兜底，书签和外链不断。 */
export default function AuditPage() {
  redirect("/admin/governance");
}
