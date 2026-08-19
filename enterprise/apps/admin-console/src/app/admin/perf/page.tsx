import { redirect } from "next/navigation";

/** 性能指标已并入「网关诊断」。旧地址保留兜底。 */
export default function AdminPerfPage() {
  redirect("/admin/diagnostics");
}
