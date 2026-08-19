import { redirect } from "next/navigation";

/** 已并入「用量与成本」的「预算与额度」。旧地址保留兜底。 */
export default function MeteringQuotaPage() {
  redirect("/metering?tab=budget");
}
