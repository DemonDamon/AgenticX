import { redirect } from "next/navigation";

/** 已并入「访问凭据」。旧地址保留兜底。 */
export default function SessionGrantsPage() {
  redirect("/admin/api-tokens?tab=grants");
}
