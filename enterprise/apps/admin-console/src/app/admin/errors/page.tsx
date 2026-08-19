import { redirect } from "next/navigation";

/** 错误聚合已并入「网关诊断」。旧地址保留兜底。 */
export default function AdminErrorsPage() {
  redirect("/admin/diagnostics");
}
